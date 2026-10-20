import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/public';
import { format as formatMoney, money } from '../../../common/money/money';
import { LedgerService } from './ledger.service';
import { csvCell } from '../../../common/csv';
import { like, pageArgs } from '../../../common/paging';

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

/** قيود صفحة الكشف — الصفحة التالية بالمؤشّر */
export const STATEMENT_PAGE = 500;
/** أطول مدة لكشف واحد أو تصدير */
export const STATEMENT_MAX_DAYS = 366;
const ZERO = { pending: 0n, available: 0n };

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
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------- المحفظة

  async wallets(vendorId: string) {
    const [wallets, holds] = await Promise.all([
      this.prisma.wallet.findMany({ where: { vendorId }, orderBy: { currency: 'asc' } }),
      this.prisma.subOrder.findMany({
        // ما لم يُحسم تحريره — المسترَدّ كله يُحسم بلا نقل، فلا يُعرض موعداً لا مال فيه
        where: { vendorId, holdReleaseAt: { not: null }, holdSettledAt: null },
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

  /**
   * كشف الحساب: كل قيد بترتيبه ورصيد الجيبين بعده — يطابق الدفتر سطراً بسطر.
   *
   * كان يحمّل دفتر البائع كله مع كل طلب — منذ أول قيد، في الذاكرة — ليحسب الرصيد
   * الافتتاحي ثم يرمي ما قبل المدة. بائع نشط يصير عشرات آلاف الصفوف لكل فتح صفحة.
   * الآن ما في المدة وحده، صفحةً صفحة (STATEMENT_PAGE)، والأرصدة مجاميع في القاعدة
   * على الفهرس (vendorId, currency, createdAt):
   * - الافتتاحي: كل ما قبل from — والختامي: كل ما حتى to — للمدة كلها لا للصفحة
   * - رصيد أول سطر في الصفحة: ما حتى المؤشّر (cursor = آخر قيد في الصفحة السابقة)
   * المؤشّر يُقارَن في القاعدة بـ (createdAt, id): الوقت مخزَّن بالميكروثانية وتاريخ
   * JavaScript بالمللي ثانية، فمقارنته هنا تُسقط قيوداً في المللي ثانية نفسها أو تكرّرها.
   */
  async statement(
    vendorId: string,
    currency: string,
    range: { from?: Date; to?: Date } = {},
    cursor?: string,
    pageSize: number = STATEMENT_PAGE,
  ) {
    if (range.from && range.to && range.to.getTime() - range.from.getTime() > STATEMENT_MAX_DAYS * 86_400_000) {
      throw new InvalidInputError(`كشف الحساب لمدة ${STATEMENT_MAX_DAYS} يوماً على الأكثر — ضيّق التاريخين.`);
    }
    if (cursor && !(await this.prisma.ledgerEntry.findFirst({ where: { id: cursor, vendorId, currency }, select: { id: true } }))) {
      throw new InvalidInputError('مؤشّر الصفحة لا يخصّ هذا الكشف — ابدأ من الصفحة الأولى.');
    }
    const from = range.from ?? null;
    const to = range.to ?? null;
    const after = cursor ?? null;
    const [opening, closing, beforePage, ids] = await Promise.all([
      from ? this.balance(Prisma.sql`"vendorId" = ${vendorId}::uuid AND "currency" = ${currency} AND "createdAt" < ${from}`) : ZERO,
      this.balance(Prisma.sql`"vendorId" = ${vendorId}::uuid AND "currency" = ${currency} AND (${to}::timestamptz IS NULL OR "createdAt" <= ${to})`),
      after
        ? this.balance(Prisma.sql`"vendorId" = ${vendorId}::uuid AND "currency" = ${currency}
            AND ("createdAt", "id") <= (SELECT c."createdAt", c."id" FROM "ledger_entries" c WHERE c."id" = ${after}::uuid)`)
        : null,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT e."id" FROM "ledger_entries" e
        WHERE e."vendorId" = ${vendorId}::uuid AND e."currency" = ${currency}
          AND (${from}::timestamptz IS NULL OR e."createdAt" >= ${from})
          AND (${to}::timestamptz IS NULL OR e."createdAt" <= ${to})
          AND (${after}::uuid IS NULL
               OR (e."createdAt", e."id") > (SELECT c."createdAt", c."id" FROM "ledger_entries" c WHERE c."id" = ${after}::uuid))
        ORDER BY e."createdAt", e."id"
        LIMIT ${pageSize + 1}`,
    ]);
    const more = ids.length > pageSize;
    const pageIds = ids.slice(0, pageSize).map((r) => r.id);
    const byId = new Map(
      (
        await this.prisma.ledgerEntry.findMany({
          where: { id: { in: pageIds } },
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
        })
      ).map((e) => [e.id, e]),
    );

    let { pending, available } = beforePage ?? opening;
    const rows: StatementRow[] = pageIds.map((id) => {
      const e = byId.get(id)!;
      const s = e.direction === 'credit' ? e.amountMinorUnits : -e.amountMinorUnits;
      if (e.bucket === 'pending') pending += s;
      else available += s;
      return {
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
      };
    });
    return {
      currency,
      opening: { pendingMinorUnits: opening.pending.toString(), availableMinorUnits: opening.available.toString() },
      closing: { pendingMinorUnits: closing.pending.toString(), availableMinorUnits: closing.available.toString() },
      rows,
      /** آخر قيد في الصفحة — يُرسل cursor للصفحة التالية؛ null حين لا صفحة بعدها */
      nextCursor: more ? pageIds[pageIds.length - 1]! : null,
    };
  }

  /** رصيد الجيبين لقيود الشرط — مجموع في القاعدة لا حلقة في الذاكرة */
  private async balance(where: Prisma.Sql): Promise<{ pending: bigint; available: bigint }> {
    const groups = await this.prisma.$queryRaw<{ bucket: string; direction: string; total: bigint | null }[]>`
      SELECT "bucket", "direction", SUM("amountMinorUnits")::bigint AS total
      FROM "ledger_entries" WHERE ${where} GROUP BY "bucket", "direction"`;
    let pending = 0n;
    let available = 0n;
    for (const g of groups) {
      const signed = g.direction === 'credit' ? (g.total ?? 0n) : -(g.total ?? 0n);
      if (g.bucket === 'pending') pending += signed;
      else available += signed;
    }
    return { pending, available };
  }

  /**
   * التصدير هو الكشف كله للمدة: يمرّ على صفحاته بالمؤشّر فلا يُحمَّل الدفتر دفعة
   * واحدة. بلا بداية يبدأ قبل سنة — مدة الكشف القصوى — لا منذ أول قيد.
   */
  async statementCsv(vendorId: string, currency: string, range: { from?: Date; to?: Date } = {}): Promise<string> {
    const from = range.from ?? new Date((range.to ?? new Date()).getTime() - STATEMENT_MAX_DAYS * 86_400_000);
    const esc = csvCell;
    const head = ['التاريخ', 'النوع', 'الطلب', 'الجيب', 'دائن', 'مدين', 'المعلّق بعده', 'المتاح بعده', 'ملاحظة', 'المعرّف', 'يعكس'];
    const lines: string[] = [head.map(esc).join(',')];
    let cursor: string | undefined;
    do {
      const page = await this.statement(vendorId, currency, { from, ...(range.to ? { to: range.to } : {}) }, cursor);
      for (const r of page.rows) {
        lines.push(
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
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    // BOM ليقرأ Excel العربية، والمبالغ بالوحدات الصغرى كما في الدفتر
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  // ---------------------------------------------------------------- السحب

  async requestPayout(vendorId: string, userId: string, input: { currency: string; amountMinorUnits: bigint }) {
    if (input.amountMinorUnits <= 0n) throw new InvalidInputError('مبلغ السحب موجب.');

    return this.prisma.$transaction(async (tx) => {
      /**
       * المعلَّق يسحب بعد حجز احترازي من تعليقه — القرار الملزم 13 كما حسمته صاحبة المشروع
       * (20 أكتوبر 2026): التعليق يوقف البيع ولا يصادر مستحقاً، لكن ما قد يُستردّ لمشترٍ (نزاع،
       * احتيال) يبقى محجوزاً مدّته. كان الرفض مطلقاً حتى يُعاد المتجر، خلافاً للقرار ولتلميح التعليق.
       */
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { status: true, nameAr: true, suspendedAt: true } });
      if (vendor?.status === 'suspended' && vendor.suspendedAt) {
        const row = await tx.setting.findUnique({ where: { key: 'suspension_payout_hold_days' } });
        const days = Number(row?.valueJson ?? 90);
        const until = new Date(vendor.suspendedAt.getTime() + (Number.isFinite(days) && days >= 0 ? days : 90) * 86_400_000);
        if (until > new Date()) {
          throw new ConflictError(
            `المتجر معلَّق، ورصيده محجوز احترازياً حتى ${until.toISOString().slice(0, 10)} — يمكن طلب السحب بعدها.`,
            { status: vendor.status, holdUntil: until.toISOString() },
          );
        }
      } else if (!vendor || vendor.status !== 'approved') {
        throw new ConflictError('حساب المتجر موقوف، والسحب متوقّف معه. راسل الدعم.', { status: vendor?.status ?? null });
      }
      const wallet = await this.ledger.lockWallet(tx, vendorId, input.currency);
      // بعد قفل المحفظة لا قبله: تبديل الافتراضي بين الفحص والسحب لا يمرّ.
      // الافتراضي الموثَّق وحده وجهة التحويل — كان الفحص على «افتراضي» فقط، وآيبان
      // كُتب فوقه من مسار التسجيل (verifiedAt = null) يبقى افتراضياً فتُحوَّل إليه الأرباح
      const bank = await tx.vendorBankAccount.findFirst({ where: { vendorId, isDefault: true, archivedAt: null } });
      if (!bank) throw new ConflictError('أضف حساباً بنكياً قبل السحب.');
      if (!bank.verifiedAt) {
        throw new ConflictError('حسابك البنكي الافتراضي لم يوثّقه فريق بسطة بعد، ولا يُحوَّل إليه شيء قبل التوثيق.');
      }
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
      // من يقرّ السحوبات يعرف: مال المتجر خرج من رصيده المتاح وينتظر موافقة (19 أكتوبر 2026)
      await this.notifications.enqueueAdmins(
        {
          code: 'admin_payout_requested',
          permission: 'payouts.approve',
          vars: {
            store_name: vendor.nameAr,
            amount: formatMoney(money(input.amountMinorUnits, input.currency)),
            link: '/admin/payouts',
          },
        },
        tx,
      );
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

  /**
   * AD-13 للإدارة — بالحالة والبحث وخمسين خمسين. البحث باسم المتجر (بالعربية أو الإنجليزية)
   * أو رابطه أو مرجع التحويل: طلب «غزة» بين مئات طلبات متاجر الاختبار لا يُرى إلا هكذا (J-11).
   */
  async adminPayouts(q: { status?: string; search?: string; page: number }) {
    const t = q.search;
    const where: Prisma.PayoutRequestWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(t ? { OR: [{ vendor: { OR: [{ nameAr: like(t) }, { nameEn: like(t) }, { slug: like(t) }] } }, { transferReference: like(t) }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(q.page),
        include: { vendor: { select: { nameAr: true } } },
      }),
      this.prisma.payoutRequest.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...present(r), vendor: r.vendor.nameAr })), total };
  }

  async approvePayout(adminId: string, id: string) {
    await this.move(adminId, id, ['requested'], { status: 'approved', approvedBy: adminId, approvedAt: new Date() }, 'payout.approve');
  }

  async markPaid(adminId: string, id: string, transferReference: string) {
    if (transferReference.trim().length < 3) throw new InvalidInputError('مرجع التحويل مطلوب.');
    await this.move(adminId, id, ['approved'], { status: 'paid', paidAt: new Date(), transferReference: transferReference.trim() }, 'payout.paid');
    const p = await this.prisma.payoutRequest.findUniqueOrThrow({ where: { id } });
    await this.notifications.enqueueVendor({
      code: 'payout_paid',
      vendorId: p.vendorId,
      vars: { amount: formatMoney(money(p.amountMinorUnits, p.currency)), reference: transferReference.trim(), link: '/vendor/finance' },
    });
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
      await this.notifications.enqueueVendor(
        {
          code: 'payout_rejected',
          vendorId: p.vendorId,
          vars: { amount: formatMoney(money(p.amountMinorUnits, p.currency)), reason: reason.trim(), link: '/vendor/finance' },
        },
        tx,
      );
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

  /** القواعد السارية: العامة وما خُصّص للمتاجر */
  async commissionRules() {
    const now = new Date();
    return this.prisma.commissionRule.findMany({
      where: { scope: { in: ['global', 'vendor'] }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: [{ scope: 'asc' }, { effectiveFrom: 'desc' }],
      include: { vendor: { select: { nameAr: true } } },
    });
  }

  /**
   * نسبة جديدة من الآن: القاعدة السارية تُنهى بـ effectiveTo ولا تُحذف،
   * والطلبات السابقة تقرأ لقطتها — لا القاعدة (ADR-004، بوابة 10 البند 2).
   */
  async setCommission(
    adminId: string,
    input: { scope: 'global' | 'vendor'; vendorId?: string | null; rateBps: number },
  ) {
    if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 5000) {
      throw new InvalidInputError('النسبة بين 0 و 50%.');
    }
    if (input.scope !== 'global' && input.scope !== 'vendor') {
      throw new InvalidInputError('النطاق: نسبة عامة أو نسبة متجر.');
    }
    const target = {
      scope: input.scope,
      vendorId: input.scope === 'vendor' ? (input.vendorId ?? null) : null,
    };
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

  /**
   * المتجر يعود إلى النسبة العامة من الآن: قاعدته تُنهى ولا تُحذف، فيتبع
   * العامة إن تغيّرت لاحقاً — نسبة خاصة تساوي العامة لا تتبعها.
   */
  async endVendorCommission(adminId: string, vendorId: string): Promise<{ ended: number }> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.commissionRule.updateMany({
        where: { scope: 'vendor', vendorId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        data: { effectiveTo: now },
      });
      if (ended.count === 0) throw new NotFoundError('لا نسبة خاصة سارية لهذا المتجر.', { vendorId });
      await tx.auditLog.create({
        data: { actorUserId: adminId, actorRole: 'admin', action: 'commission.end', entityType: 'Vendor', entityId: vendorId, afterJson: { scope: 'vendor', vendorId, ended: ended.count } },
      });
      return { ended: ended.count };
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
