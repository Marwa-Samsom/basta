import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LedgerService } from './ledger.service';

export const ENTRY_LABELS: Record<string, string> = {
  sale_credit: 'مبيعات',
  shipping_credit: 'شحن',
  commission_debit: 'عمولة المنصة',
  hold_release_out: 'تحرير من المعلّق',
  hold_release_in: 'تحرير إلى المتاح',
  refund_debit: 'استرداد للمشتري',
  payout_debit: 'سحب',
  adjustment_credit: 'تسوية دائنة',
  adjustment_debit: 'تسوية مدينة',
  fx_rounding: 'فرق صرف',
};

export interface StatementRow {
  id: string;
  createdAt: Date;
  entryType: string;
  label: string;
  direction: string;
  bucket: string;
  amountMinorUnits: string;
  subOrderNumber: string | null;
  memo: string | null;
  reversesEntryId: string | null;
  pendingAfter: string;
  availableAfter: string;
}

/**
 * المحفظة وكشف الحساب والسحب — VD-18…21 و AD-08.
 *
 * السحب يقفل المحفظة ثم يقرأ رصيدها ثم يخصم، في معاملة واحدة: سحبان
 * متزامنان يمرّ أحدهما والآخر يرى الرصيد بعد الخصم (بوابة 10 البند 4).
 * المبلغ يُخصم من المتاح لحظة الطلب لا لحظة التحويل — طلب معلّق يحجز ماله،
 * والرفض قيد معاكس يعيده.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // -------------------------------------------------------------- المحفظة

  async wallets(vendorId: string) {
    const [wallets, holds] = await Promise.all([
      this.prisma.wallet.findMany({ where: { vendorId }, orderBy: { currency: 'asc' } }),
      this.prisma.subOrder.findMany({
        where: { vendorId, holdReleaseAt: { not: null }, ledgerEntries: { none: { entryType: 'hold_release_out' } } },
        select: { settlementCurrency: true, holdReleaseAt: true },
        orderBy: { holdReleaseAt: 'asc' },
      }),
    ]);
    return wallets.map((w) => ({
      currency: w.currency,
      pendingMinorUnits: w.balancePendingMinorUnits.toString(),
      availableMinorUnits: w.balanceAvailableMinorUnits.toString(),
      withdrawnMinorUnits: w.balanceWithdrawnMinorUnits.toString(),
      // أقرب موعد تحرير — «متى يصير مالي متاحاً؟» أول سؤال لكل بائع
      nextReleaseAt: holds.find((h) => h.settlementCurrency === w.currency)?.holdReleaseAt ?? null,
      canWithdraw: w.balanceAvailableMinorUnits > 0n,
    }));
  }

  /** كشف الحساب: كل قيد بترتيبه ورصيد الجيبين بعده — يطابق الدفتر سطراً بسطر */
  async statement(vendorId: string, currency: string, range: { from?: Date; to?: Date } = {}) {
    const all = await this.prisma.ledgerEntry.findMany({
      where: { vendorId, currency },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        createdAt: true,
        entryType: true,
        direction: true,
        bucket: true,
        amountMinorUnits: true,
        memo: true,
        reversesEntryId: true,
        subOrder: { select: { subOrderNumber: true } },
      },
    });
    let pending = 0n;
    let available = 0n;
    let opening = { pending: 0n, available: 0n };
    const rows: StatementRow[] = [];
    for (const e of all) {
      const s = e.direction === 'credit' ? e.amountMinorUnits : -e.amountMinorUnits;
      if (e.bucket === 'pending') pending += s;
      else available += s;
      if (range.from && e.createdAt < range.from) {
        opening = { pending, available };
        continue;
      }
      if (range.to && e.createdAt > range.to) continue;
      rows.push({
        id: e.id,
        createdAt: e.createdAt,
        entryType: e.entryType,
        label: ENTRY_LABELS[e.entryType] ?? e.entryType,
        direction: e.direction,
        bucket: e.bucket,
        amountMinorUnits: e.amountMinorUnits.toString(),
        subOrderNumber: e.subOrder?.subOrderNumber ?? null,
        memo: e.memo,
        reversesEntryId: e.reversesEntryId,
        pendingAfter: pending.toString(),
        availableAfter: available.toString(),
      });
    }
    const last = rows[rows.length - 1];
    return {
      currency,
      opening: { pendingMinorUnits: opening.pending.toString(), availableMinorUnits: opening.available.toString() },
      closing: {
        pendingMinorUnits: last?.pendingAfter ?? opening.pending.toString(),
        availableMinorUnits: last?.availableAfter ?? opening.available.toString(),
      },
      rows,
    };
  }

  async statementCsv(vendorId: string, currency: string, range: { from?: Date; to?: Date } = {}): Promise<string> {
    const s = await this.statement(vendorId, currency, range);
    const esc = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const head = ['التاريخ', 'النوع', 'الطلب', 'الجيب', 'دائن', 'مدين', 'المعلّق بعده', 'المتاح بعده', 'ملاحظة', 'المعرّف', 'يعكس'];
    const lines = s.rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.label,
        r.subOrderNumber,
        r.bucket === 'pending' ? 'معلّق' : 'متاح',
        r.direction === 'credit' ? r.amountMinorUnits : '',
        r.direction === 'debit' ? r.amountMinorUnits : '',
        r.pendingAfter,
        r.availableAfter,
        r.memo,
        r.id,
        r.reversesEntryId,
      ]
        .map((v) => esc(v))
        .join(','),
    );
    // BOM ليقرأ Excel العربية، والمبالغ بالوحدات الصغرى كما في الدفتر
    return `﻿${[head.map(esc).join(','), ...lines].join('\r\n')}\r\n`;
  }

  // ---------------------------------------------------------------- السحب

  async requestPayout(vendorId: string, userId: string, input: { currency: string; amountMinorUnits: bigint }) {
    if (input.amountMinorUnits <= 0n) throw new InvalidInputError('مبلغ السحب موجب.');
    const bank = await this.prisma.vendorBankAccount.findFirst({
      where: { vendorId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    if (!bank) throw new ConflictError('أضف حساباً بنكياً قبل السحب.');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.ledger.lockWallet(tx, vendorId, input.currency);
      // القراءة بعد القفل: السحب المتزامن ينتظر هنا ثم يرى الرصيد بعد الأول
      if (wallet.available < input.amountMinorUnits) {
        throw new ConflictError('المبلغ أكبر من رصيدك المتاح.', {
          availableMinorUnits: wallet.available.toString(),
        });
      }
      const [entryId] = await this.ledger.appendVendor(
        tx,
        wallet,
        [{ entryType: 'payout_debit', direction: 'debit', amount: input.amountMinorUnits, bucket: 'available', memo: 'طلب سحب' }],
        { refType: 'payout', refId: null, createdBy: userId },
      );
      const payout = await tx.payoutRequest.create({
        data: {
          vendorId,
          walletId: wallet.id,
          currency: input.currency,
          amountMinorUnits: input.amountMinorUnits,
          bankAccountSnapshot: {
            holderName: bank.holderName,
            bankName: bank.bankName,
            iban: bank.iban,
            swift: bank.swift,
          } as Prisma.InputJsonValue,
          ledgerEntryId: entryId!,
        },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, actorRole: 'vendor_owner', action: 'payout.request', entityType: 'PayoutRequest', entityId: payout.id, afterJson: { amount: input.amountMinorUnits.toString(), currency: input.currency } },
      });
      return present(payout);
    });
  }

  async payouts(filter: { vendorId?: string; status?: string }) {
    const rows = await this.prisma.payoutRequest.findMany({
      where: {
        ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
      include: { vendor: { select: { nameAr: true } } },
    });
    return rows.map((r) => ({ ...present(r), vendor: r.vendor.nameAr }));
  }

  async approvePayout(adminId: string, id: string) {
    await this.move(adminId, id, ['requested'], { status: 'approved', approvedBy: adminId, approvedAt: new Date() }, 'payout.approve');
  }

  async markPaid(adminId: string, id: string, transferReference: string) {
    if (transferReference.trim().length < 3) throw new InvalidInputError('مرجع التحويل مطلوب.');
    await this.move(adminId, id, ['approved'], { status: 'paid', paidAt: new Date(), transferReference: transferReference.trim() }, 'payout.paid');
  }

  /** الرفض قيد معاكس يعيد المال للمتاح — لا حذف لقيد السحب */
  async rejectPayout(adminId: string, id: string, reason: string) {
    if (reason.trim().length < 5) throw new InvalidInputError('سبب الرفض مطلوب ويُعرض للبائع.');
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payoutRequest.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('طلب السحب غير موجود.', { id });
      const wallet = await this.ledger.lockWallet(tx, p.vendorId, p.currency);
      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: { in: ['requested', 'approved'] } },
        data: { status: 'rejected', rejectReason: reason.trim(), approvedBy: adminId },
      });
      if (count === 0) throw new ConflictError('لا يُرفض إلا طلب لم يُحوَّل بعد.');
      await this.ledger.appendVendor(
        tx,
        wallet,
        [{
          entryType: 'payout_debit',
          direction: 'credit',
          amount: p.amountMinorUnits,
          bucket: 'available',
          reversesEntryId: p.ledgerEntryId,
          memo: `رُفض طلب السحب: ${reason.trim()}`,
        }],
        { refType: 'payout', refId: null, createdBy: adminId },
      );
      await tx.auditLog.create({
        data: { actorUserId: adminId, actorRole: 'admin', action: 'payout.reject', entityType: 'PayoutRequest', entityId: id, afterJson: { reason } },
      });
    });
  }

  private async move(adminId: string, id: string, from: string[], data: Prisma.PayoutRequestUpdateManyMutationInput, action: string) {
    const { count } = await this.prisma.payoutRequest.updateMany({ where: { id, status: { in: from as never[] } }, data });
    if (count === 0) {
      const exists = await this.prisma.payoutRequest.count({ where: { id } });
      if (!exists) throw new NotFoundError('طلب السحب غير موجود.', { id });
      throw new ConflictError('حالة الطلب لا تسمح بهذا الإجراء.');
    }
    await this.prisma.auditLog.create({
      data: { actorUserId: adminId, actorRole: 'admin', action, entityType: 'PayoutRequest', entityId: id, afterJson: data as Prisma.InputJsonValue },
    });
  }

  // --------------------------------------------------------------- العمولات

  async commissionRules() {
    const now = new Date();
    return this.prisma.commissionRule.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: [{ scope: 'asc' }, { effectiveFrom: 'desc' }],
      include: { category: { select: { nameAr: true, slug: true } }, vendor: { select: { nameAr: true } } },
    });
  }

  /**
   * نسبة جديدة من الآن: القاعدة السارية تُنهى بـ effectiveTo ولا تُحذف،
   * والطلبات السابقة تقرأ لقطتها — لا القاعدة (ADR-004، بوابة 10 البند 2).
   */
  async setCommission(
    adminId: string,
    input: { scope: 'global' | 'category' | 'vendor'; categoryId?: string | null; vendorId?: string | null; rateBps: number },
  ) {
    if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 5000) {
      throw new InvalidInputError('النسبة بين 0 و 50%.');
    }
    const target = {
      scope: input.scope,
      categoryId: input.scope === 'category' ? (input.categoryId ?? null) : null,
      vendorId: input.scope === 'vendor' ? (input.vendorId ?? null) : null,
    };
    if (input.scope === 'category' && !target.categoryId) throw new InvalidInputError('اختر الفئة.');
    if (input.scope === 'vendor' && !target.vendorId) throw new InvalidInputError('اختر المتجر.');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.commissionRule.updateMany({
        where: { ...target, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        data: { effectiveTo: now },
      });
      const rule = await tx.commissionRule.create({
        data: { ...target, rateBps: input.rateBps, effectiveFrom: now, createdBy: adminId },
      });
      await tx.auditLog.create({
        data: { actorUserId: adminId, actorRole: 'admin', action: 'commission.set', entityType: 'CommissionRule', entityId: rule.id, afterJson: { ...target, rateBps: input.rateBps, ended: ended.count } },
      });
      return rule;
    });
  }

  // ---------------------------------------------------------------- التقرير

  /** ملخّص المنصة لكل عملة — عمولة وضريبة ودعم، من دفترها لا من الطلبات */
  async platformSummary() {
    const rows = await this.prisma.$queryRaw<{ currency: string; entryType: string; net: bigint }[]>`
      SELECT "currency", "entryType",
             SUM(CASE WHEN "direction" = 'credit' THEN "amountMinorUnits" ELSE -"amountMinorUnits" END)::bigint AS net
      FROM "platform_ledger_entries" GROUP BY "currency", "entryType" ORDER BY "currency", "entryType"`;
    return rows.map((r) => ({ ...r, net: r.net.toString() }));
  }
}

function present(p: {
  id: string;
  currency: string;
  amountMinorUnits: bigint;
  status: string;
  requestedAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  transferReference: string | null;
  rejectReason: string | null;
  bankAccountSnapshot: Prisma.JsonValue;
}) {
  const bank = (p.bankAccountSnapshot ?? {}) as Record<string, string>;
  return {
    id: p.id,
    currency: p.currency,
    amountMinorUnits: p.amountMinorUnits.toString(),
    status: p.status,
    requestedAt: p.requestedAt,
    approvedAt: p.approvedAt,
    paidAt: p.paidAt,
    transferReference: p.transferReference,
    rejectReason: p.rejectReason,
    // آخر أربعة أرقام تكفي للتعرّف — لا يُعاد رقم الحساب كاملاً في القوائم
    bank: { bankName: bank['bankName'] ?? '', holderName: bank['holderName'] ?? '', ibanLast4: (bank['iban'] ?? '').slice(-4) },
  };
}
