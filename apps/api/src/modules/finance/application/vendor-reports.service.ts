import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { InvalidInputError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface ReportRange {
  from: Date;
  to: Date;
}

const DAY = 86_400_000;
export const MAX_REPORT_DAYS = 366;

/**
 * حالات لم يُسلَّم فيها شيء — لا تُحسب في «الأكثر مبيعاً». «refunded» ليست
 * منها: الإرجاع الجزئي ينتهي إليها أيضاً، والاسترداد الكامل يملأ refundedQty
 * بالكمية كلها — فالوحدات الصافية (qty − refundedQty) تكفي وحدها.
 */
const VOID_STATUSES = ['rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin'];

const signed = (direction: string, amount: bigint): bigint => (direction === 'credit' ? amount : -amount);
const s = (v: bigint | null | undefined): string => (v ?? 0n).toString();
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * «من … إلى …» بأيام UTC كاملة، كما يقرأ كشف الحساب مداه. بلا مدى: آخر
 * ثلاثين يوماً حتى اليوم. المدى الأطول من سنة مرفوض — التقرير ليس أرشيفاً.
 */
export function reportRange(from?: string, to?: string, now = new Date()): ReportRange {
  const end = to ? new Date(`${to}T00:00:00.000Z`) : new Date(`${isoDay(now)}T00:00:00.000Z`);
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - 29 * DAY);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new InvalidInputError('تاريخ غير صالح.');
  if (start > end) throw new InvalidInputError('بداية المدى بعد نهايته — بدّل التاريخين.');
  const days = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  if (days > MAX_REPORT_DAYS) throw new InvalidInputError(`المدى ${MAX_REPORT_DAYS} يوماً على الأكثر.`);
  return { from: start, to: new Date(end.getTime() + DAY) }; // [from, to) — اليوم الأخير كاملاً
}

/**
 * تقارير البائع — VD-19. المقابل البائعي لتقارير الإدارة (AD-03)، وبالقاعدة
 * نفسها: **كل رقم مالي من الدفتر** (ledger_entries) لا من إجماليات الطلبات؛
 * فما يراه البائع هنا وما في كشف حسابه مصدر واحد.
 *
 *   المبيعات   = قيود sale_credit (بعد خصم يموّله البائع)
 *   الشحن      = قيود shipping_credit
 *   العمولة    = صافي commission_debit (المخصوم ناقص ما عُكس بالمرتجعات)
 *   المرتجعات  = صافي refund_debit
 *   الصافي     = كل قيود البائع عدا التحرير بين الجيبين والسحب — أي ما كسبه
 *
 * كل ذلك **لكل عملة وحدها** (ADR-013، INV-12)؛ لا جمع بين عملتين أبداً.
 * العدّادات (حالات الطلبات، الوحدات) ليست مالاً فتُقرأ من الطلبات، وإيراد
 * «الأكثر مبيعاً» قيمة منتجات لا قيد لها في الدفتر لكل منتج — يُقرأ من
 * سطور الطلب بعملة البائع، ويُسمّى كذلك في الواجهة.
 *
 * كل استعلام يبدأ بـ vendorId من نطاق الفاعل — لا معامل آخر يختار البائع.
 */
@Injectable()
export class VendorReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(vendorId: string, r: ReportRange) {
    const [ledger, daily, statuses, delivered, top] = await Promise.all([
      this.prisma.$queryRaw<{ currency: string; entryType: string; direction: string; amount: bigint; orders: bigint }[]>`
        SELECT "currency", "entryType"::text AS "entryType", "direction",
               SUM("amountMinorUnits")::bigint AS amount,
               COUNT(DISTINCT "refId")::bigint AS orders
        FROM "ledger_entries"
        WHERE "vendorId" = ${vendorId}::uuid AND "createdAt" >= ${r.from} AND "createdAt" < ${r.to}
        GROUP BY "currency", "entryType", "direction"`,
      this.prisma.$queryRaw<{ currency: string; day: string; sales: bigint; orders: bigint }[]>`
        SELECT "currency", to_char(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
               SUM(CASE WHEN "direction" = 'credit' THEN "amountMinorUnits" ELSE -"amountMinorUnits" END)::bigint AS sales,
               COUNT(DISTINCT "refId")::bigint AS orders
        FROM "ledger_entries"
        WHERE "vendorId" = ${vendorId}::uuid AND "entryType" = 'sale_credit'
          AND "createdAt" >= ${r.from} AND "createdAt" < ${r.to}
        GROUP BY "currency", day`,
      this.prisma.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT "status"::text AS status, COUNT(*)::bigint AS n FROM "sub_orders"
        WHERE "vendorId" = ${vendorId}::uuid AND "placedAt" >= ${r.from} AND "placedAt" < ${r.to}
        GROUP BY "status"`,
      this.prisma.$queryRaw<{ delivered: bigint; returned: bigint }[]>`
        SELECT COUNT(*)::bigint AS delivered,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "return_requests" rr WHERE rr."subOrderId" = so."id"))::bigint AS returned
        FROM "sub_orders" so
        WHERE so."vendorId" = ${vendorId}::uuid AND so."deliveredAt" IS NOT NULL
          AND so."placedAt" >= ${r.from} AND so."placedAt" < ${r.to}`,
      this.prisma.$queryRaw<{ currency: string; productId: string; nameAr: string; units: bigint; revenue: bigint }[]>`
        SELECT so."settlementCurrency" AS currency, oi."productId" AS "productId",
               (ARRAY_AGG(oi."productNameSnapshotAr" ORDER BY so."placedAt" DESC))[1] AS "nameAr",
               SUM(oi."qty" - oi."refundedQty")::bigint AS units,
               SUM((oi."lineSubtotalMinorUnits" * (oi."qty" - oi."refundedQty")) / oi."qty")::bigint AS revenue
        FROM "order_items" oi JOIN "sub_orders" so ON so."id" = oi."subOrderId"
        WHERE so."vendorId" = ${vendorId}::uuid AND so."placedAt" >= ${r.from} AND so."placedAt" < ${r.to}
          AND so."status"::text <> ALL (${VOID_STATUSES}::text[])
        GROUP BY so."settlementCurrency", oi."productId"
        HAVING SUM(oi."qty" - oi."refundedQty") > 0`,
    ]);

    const days: string[] = [];
    for (let t = r.from.getTime(); t < r.to.getTime(); t += DAY) days.push(isoDay(new Date(t)));

    const currencies = [...new Set([...ledger.map((x) => x.currency), ...top.map((x) => x.currency)])].sort();
    const byCurrency = currencies.map((currency) => {
      const rows = ledger.filter((x) => x.currency === currency);
      const net = (...types: string[]) =>
        rows.filter((x) => types.includes(x.entryType)).reduce((a, x) => a + signed(x.direction, x.amount), 0n);
      const sales = net('sale_credit');
      const paidOrders = rows.find((x) => x.entryType === 'sale_credit' && x.direction === 'credit')?.orders ?? 0n;
      const series = new Map(daily.filter((x) => x.currency === currency).map((x) => [x.day, x]));
      return {
        currency,
        salesMinorUnits: s(sales),
        shippingMinorUnits: s(net('shipping_credit')),
        commissionMinorUnits: s(-net('commission_debit')),
        refundsMinorUnits: s(-net('refund_debit')),
        adjustmentsMinorUnits: s(net('adjustment_credit', 'adjustment_debit', 'fx_rounding')),
        netMinorUnits: s(
          net('sale_credit', 'shipping_credit', 'commission_debit', 'refund_debit', 'adjustment_credit', 'adjustment_debit', 'fx_rounding'),
        ),
        paidOrders: Number(paidOrders),
        averageOrderMinorUnits: s(paidOrders > 0n ? sales / paidOrders : 0n),
        series: days.map((day) => ({
          day,
          salesMinorUnits: s(series.get(day)?.sales),
          orders: Number(series.get(day)?.orders ?? 0n),
        })),
        topProducts: top
          .filter((x) => x.currency === currency)
          .sort((a, b) => (b.units !== a.units ? Number(b.units - a.units) : Number(b.revenue - a.revenue)))
          .slice(0, 5)
          .map((x) => ({ productId: x.productId, nameAr: x.nameAr, units: Number(x.units), revenueMinorUnits: s(x.revenue) })),
      };
    });

    const byStatus = Object.fromEntries(statuses.map((x) => [x.status, Number(x.n)]));
    const deliveredN = Number(delivered[0]?.delivered ?? 0n);
    const returnedN = Number(delivered[0]?.returned ?? 0n);
    return {
      range: { from: isoDay(r.from), to: isoDay(new Date(r.to.getTime() - DAY)), days: days.length },
      currencies: byCurrency,
      orders: {
        total: statuses.reduce((a, x) => a + Number(x.n), 0),
        byStatus,
        rejectedByVendor: byStatus['rejected_by_vendor'] ?? 0,
        delivered: deliveredN,
        withReturn: returnedN,
        returnRatePct: deliveredN > 0 ? Math.round((returnedN / deliveredN) * 1000) / 10 : null,
      },
    };
  }

  // ------------------------------------------------------------- التصدير

  private async sections(vendorId: string, r: ReportRange) {
    const rep = await this.report(vendorId, r);
    type Row = Record<string, string | number | null>;
    const sections: { name: string; rows: Row[] }[] = [
      {
        name: 'الملخّص',
        rows: rep.currencies.map((c) => ({
          'العملة': c.currency, 'المبيعات': c.salesMinorUnits, 'الشحن': c.shippingMinorUnits, 'العمولة': c.commissionMinorUnits,
          'المرتجعات': c.refundsMinorUnits, 'التسويات': c.adjustmentsMinorUnits, 'الصافي': c.netMinorUnits,
          'طلبات مدفوعة': c.paidOrders, 'متوسط الطلب': c.averageOrderMinorUnits,
        })),
      },
      {
        name: 'يومياً',
        rows: rep.currencies.flatMap((c) =>
          c.series.map((d) => ({ 'العملة': c.currency, 'اليوم': d.day, 'المبيعات': d.salesMinorUnits, 'الطلبات': d.orders })),
        ),
      },
      {
        name: 'الأكثر مبيعاً',
        rows: rep.currencies.flatMap((c) =>
          c.topProducts.map((p, i) => ({ 'العملة': c.currency, '#': i + 1, 'المنتج': p.nameAr, 'الوحدات': p.units, 'قيمة المنتجات': p.revenueMinorUnits })),
        ),
      },
      {
        name: 'الطلبات',
        rows: Object.entries(rep.orders.byStatus).map(([k, v]) => ({ 'الحالة': k, 'العدد': v })),
      },
    ];
    return { rep, sections };
  }

  async csv(vendorId: string, r: ReportRange): Promise<string> {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const { rep, sections } = await this.sections(vendorId, r);
    const parts: string[] = [`${esc('الفترة')},${esc(rep.range.from)},${esc(rep.range.to)}`, esc('المبالغ بالوحدات الصغرى لكل عملة')];
    for (const sec of sections) {
      parts.push('', esc(sec.name));
      const head = Object.keys(sec.rows[0] ?? {});
      if (head.length) parts.push(head.map(esc).join(','), ...sec.rows.map((row) => head.map((h) => esc(row[h])).join(',')));
    }
    return `﻿${parts.join('\r\n')}\r\n`;
  }

  async xlsx(vendorId: string, r: ReportRange): Promise<Buffer> {
    const { sections } = await this.sections(vendorId, r);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Basta';
    for (const sec of sections) {
      const ws = wb.addWorksheet(sec.name, { views: [{ rightToLeft: true }] });
      const head = Object.keys(sec.rows[0] ?? {});
      ws.addRow(head).font = { bold: true };
      for (const row of sec.rows) ws.addRow(head.map((h) => row[h]));
      ws.columns.forEach((c) => (c.width = 18));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
