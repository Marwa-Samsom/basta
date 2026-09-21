import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  fullRefundPostings,
  net,
  partialRefundPostings,
  salePostings,
  type PlatformEntryType,
  type PlatformPosting,
  type SubOrderMoney,
  type VendorPosting,
} from '../domain/postings';

export type Tx = Prisma.TransactionClient;

export interface LockedWallet {
  id: string;
  vendorId: string;
  currency: string;
  pending: bigint;
  available: bigint;
  withdrawn: bigint;
}

/**
 * الدفتر — ADR-005. كل كتابة هنا:
 *   · داخل معاملة المستدعي (البيع مع التقسيم، الاسترداد مع الانتقال)
 *   · بعد قفل صف المحفظة `FOR UPDATE` — لا تعديلان متزامنان على رصيد واحد
 *   · إضافة فقط؛ الأرصدة إسقاط يُحدَّث في المعاملة نفسها ويُدقَّق بمنظر
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** يقفل محفظة (بائع، عملة) وينشئها إن لم توجد — بلا سباق على الإنشاء */
  async lockWallet(tx: Tx, vendorId: string, currency: string): Promise<LockedWallet> {
    await tx.$executeRaw`
      INSERT INTO "wallets" ("id", "vendorId", "currency", "updatedAt")
      VALUES (gen_random_uuid(), ${vendorId}::uuid, ${currency}, now())
      ON CONFLICT ("vendorId", "currency") DO NOTHING`;
    const rows = await tx.$queryRaw<
      { id: string; pending: bigint; available: bigint; withdrawn: bigint }[]
    >`SELECT "id", "balancePendingMinorUnits" AS pending, "balanceAvailableMinorUnits" AS available,
             "balanceWithdrawnMinorUnits" AS withdrawn
      FROM "wallets" WHERE "vendorId" = ${vendorId}::uuid AND "currency" = ${currency}
      FOR UPDATE`;
    const w = rows[0]!;
    return { id: w.id, vendorId, currency, pending: w.pending, available: w.available, withdrawn: w.withdrawn };
  }

  /** يضيف قيود البائع ويحدّث إسقاط المحفظة — يعيد معرّفات القيود بترتيبها */
  async appendVendor(
    tx: Tx,
    wallet: LockedWallet,
    postings: readonly (VendorPosting & { bucket: 'pending' | 'available'; reversesEntryId?: string | null })[],
    ref: { refType: string; refId: string | null; createdBy?: string | null },
  ): Promise<string[]> {
    const ids: string[] = [];
    let dPending = 0n;
    let dAvailable = 0n;
    let dWithdrawn = 0n;
    for (const p of postings) {
      if (p.amount <= 0n) continue;
      const row = await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          vendorId: wallet.vendorId,
          currency: wallet.currency,
          entryType: p.entryType,
          direction: p.direction,
          amountMinorUnits: p.amount,
          bucket: p.bucket,
          refType: ref.refType,
          refId: ref.refId,
          reversesEntryId: p.reversesEntryId ?? null,
          memo: p.memo ?? null,
          createdBy: ref.createdBy ?? null,
        },
        select: { id: true },
      });
      ids.push(row.id);
      const s = p.direction === 'credit' ? p.amount : -p.amount;
      if (p.bucket === 'pending') dPending += s;
      else dAvailable += s;
      if (p.entryType === 'payout_debit') dWithdrawn -= s;
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balancePendingMinorUnits: { increment: dPending },
        balanceAvailableMinorUnits: { increment: dAvailable },
        balanceWithdrawnMinorUnits: { increment: dWithdrawn },
        version: { increment: 1 },
      },
    });
    wallet.pending += dPending;
    wallet.available += dAvailable;
    wallet.withdrawn += dWithdrawn;
    return ids;
  }

  private async appendPlatform(
    tx: Tx,
    subOrderId: string,
    currency: string,
    postings: readonly PlatformPosting[],
    refundId: string | null,
  ): Promise<void> {
    const rows = postings.filter((p) => p.amount > 0n);
    if (rows.length === 0) return;
    await tx.platformLedgerEntry.createMany({
      data: rows.map((p) => ({
        subOrderId,
        currency,
        entryType: p.entryType,
        direction: p.direction,
        amountMinorUnits: p.amount,
        memo: p.memo ?? null,
        refundId,
      })),
    });
  }

  // ------------------------------------------------------------------ البيع

  /**
   * قيود البيع لحظة نجاح الدفع، في معاملة التقسيم نفسها — فرعي بلا قيود
   * لا يوجد (audit_sub_order_without_ledger). الفهرس الفريد على قيد البيع
   * يمنع التكرار في القاعدة ولو تجاوزه التطبيق.
   */
  async postSale(tx: Tx, subOrderId: string): Promise<void> {
    const sub = await this.money(tx, subOrderId);
    const { vendor, platform } = salePostings(sub.money);
    const wallet = await this.lockWallet(tx, sub.vendorId, sub.currency);
    await this.appendVendor(
      tx,
      wallet,
      vendor.map((p) => ({ ...p, bucket: 'pending' as const })),
      { refType: 'sub_order', refId: subOrderId },
    );
    await this.appendPlatform(tx, subOrderId, sub.currency, platform, null);
  }

  // -------------------------------------------------------------- الاسترداد

  /**
   * إرجاع جزئي. يعيد ما يستردّه المشتري بعملة البائع، ومعرّف قيد الخصم.
   * قبل التحرير يُخصم من المعلّق (مال هذا الطلب نفسه)، وبعده من المتاح —
   * ولو صار سالباً: حالة مشروعة موثّقة بسببها في القيد (ADR-007)، والسحب
   * ممنوع حتى تغطيها مبيعات لاحقة.
   */
  async postPartialRefund(
    tx: Tx,
    subOrderId: string,
    returned: readonly { orderItemId: string; qty: number }[],
    refundId: string,
    by: string | null,
  ): Promise<{ vendorAmount: bigint; ledgerEntryId: string | null }> {
    const sub = await this.money(tx, subOrderId);
    const lines = await tx.orderItem.findMany({
      where: { subOrderId },
      select: {
        id: true, qty: true, refundedQty: true, lineSubtotalMinorUnits: true, lineDiscountMinorUnits: true,
        lineTaxMinorUnits: true, lineTotalMinorUnits: true, commissionMinorUnits: true,
      },
    });
    const plan = partialRefundPostings(
      sub.money,
      lines.map((l) => ({
        orderItemId: l.id,
        qty: l.qty,
        refundedQty: l.refundedQty,
        lineSubtotal: l.lineSubtotalMinorUnits,
        lineDiscount: l.lineDiscountMinorUnits,
        lineTax: l.lineTaxMinorUnits,
        lineTotal: l.lineTotalMinorUnits,
        commission: l.commissionMinorUnits,
      })),
      returned,
    );
    const ledgerEntryId = await this.postRefundSide(tx, sub, plan.vendor, refundId, by);
    await this.appendPlatform(tx, subOrderId, sub.currency, plan.platform, refundId);
    return { vendorAmount: plan.buyerGets, ledgerEntryId };
  }

  /** استرداد كامل: يُصفَّر كل ما بقي للبائع وللمنصة، ويعود الباقي للمشتري */
  async postFullRefund(
    tx: Tx,
    subOrderId: string,
    refundId: string,
    by: string | null,
  ): Promise<{ vendorAmount: bigint; ledgerEntryId: string | null }> {
    const sub = await this.money(tx, subOrderId);
    const vendorRows = await tx.ledgerEntry.findMany({
      where: { refType: 'sub_order', refId: subOrderId },
      select: { direction: true, amountMinorUnits: true },
    });
    const platformRows = await tx.platformLedgerEntry.findMany({
      where: { subOrderId },
      select: { entryType: true, direction: true, amountMinorUnits: true },
    });
    const byType = new Map<PlatformEntryType, bigint>();
    for (const r of platformRows) {
      const t = r.entryType as PlatformEntryType;
      byType.set(t, (byType.get(t) ?? 0n) + (r.direction === 'credit' ? r.amountMinorUnits : -r.amountMinorUnits));
    }
    const plan = fullRefundPostings(
      net(vendorRows.map((r) => ({ direction: r.direction, amount: r.amountMinorUnits }))),
      byType,
    );
    const ledgerEntryId = await this.postRefundSide(tx, sub, plan.vendor, refundId, by);
    await this.appendPlatform(tx, subOrderId, sub.currency, plan.platform, refundId);
    return { vendorAmount: plan.buyerGets, ledgerEntryId };
  }

  private async postRefundSide(
    tx: Tx,
    sub: { id: string; vendorId: string; currency: string },
    postings: readonly VendorPosting[],
    refundId: string,
    by: string | null,
  ): Promise<string | null> {
    if (postings.length === 0) return null;
    const wallet = await this.lockWallet(tx, sub.vendorId, sub.currency);
    const released = await tx.ledgerEntry.findFirst({
      where: { refType: 'sub_order', refId: sub.id, entryType: 'hold_release_out', reversesEntryId: null },
      select: { id: true },
    });
    const commissionEntry = await tx.ledgerEntry.findFirst({
      where: { refType: 'sub_order', refId: sub.id, entryType: 'commission_debit', direction: 'debit' },
      select: { id: true },
    });
    const bucket: 'pending' | 'available' = released ? 'available' : 'pending';
    const debit = postings.reduce((a, p) => a + (p.direction === 'debit' ? p.amount : -p.amount), 0n);
    const goesNegative = bucket === 'available' && wallet.available - debit < 0n;
    const ids = await this.appendVendor(
      tx,
      wallet,
      postings.map((p) => ({
        ...p,
        bucket,
        reversesEntryId: p.reverses === 'commission_debit' ? (commissionEntry?.id ?? null) : null,
        memo: [
          p.memo,
          `استرداد ${refundId.slice(0, 8)}`,
          released ? 'بعد تحرير الرصيد' : null,
          goesNegative && p.direction === 'debit' ? 'الرصيد المتاح سالب حتى تغطيه مبيعات لاحقة — السحب موقوف' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      { refType: 'sub_order', refId: sub.id, createdBy: by },
    );
    return ids[0] ?? null;
  }

  // ---------------------------------------------------------------- التحرير

  /**
   * ينقل معلّق فرعي إلى المتاح بقيدين متقابلين — ADR-007. يُستدعى من المهمة
   * بعد التحقق من الشروط. الفهرس الفريد على hold_release_out يمنع تحريراً ثانياً.
   */
  async release(tx: Tx, subOrderId: string): Promise<bigint> {
    const sub = await tx.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      select: { vendorId: true, settlementCurrency: true },
    });
    const wallet = await this.lockWallet(tx, sub.vendorId, sub.settlementCurrency);
    const rows = await tx.ledgerEntry.findMany({
      where: { refType: 'sub_order', refId: subOrderId, bucket: 'pending' },
      select: { direction: true, amountMinorUnits: true },
    });
    const pending = net(rows.map((r) => ({ direction: r.direction, amount: r.amountMinorUnits })));
    if (pending <= 0n) return 0n;
    await this.appendVendor(
      tx,
      wallet,
      [
        { entryType: 'hold_release_out', direction: 'debit', amount: pending, bucket: 'pending', memo: 'انقضت فترة التعليق' },
        { entryType: 'hold_release_in', direction: 'credit', amount: pending, bucket: 'available', memo: 'انقضت فترة التعليق' },
      ],
      { refType: 'sub_order', refId: subOrderId },
    );
    return pending;
  }

  // ---------------------------------------------------------------- مساعد

  private async money(tx: Tx, subOrderId: string) {
    const s = await tx.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        vendorId: true,
        settlementCurrency: true,
        itemsSubtotalMinorUnits: true,
        discountMinorUnits: true,
        shippingMinorUnits: true,
        totalMinorUnits: true,
        commissionMinorUnits: true,
        vendorNetMinorUnits: true,
      },
    });
    if (!s) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    const money: SubOrderMoney = {
      items: s.itemsSubtotalMinorUnits,
      discount: s.discountMinorUnits,
      shipping: s.shippingMinorUnits,
      total: s.totalMinorUnits,
      commission: s.commissionMinorUnits,
      vendorNet: s.vendorNetMinorUnits,
    };
    return { id: s.id, vendorId: s.vendorId, currency: s.settlementCurrency, money };
  }
}
