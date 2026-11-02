import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { convert, money, toDecimalString } from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { csvCell } from '../../../common/csv';
import { acceptanceDueSince } from '../domain/acceptance';

export interface Range {
  from: Date;
  to: Date;
}

type Cell = string | number | null;
/** عمود في ورقة التصدير: عنوانه، وقيمته من سطر القسم */
type Column<T> = readonly [label: string, value: (x: T) => Cell];
interface Section {
  name: string;
  head: string[];
  rows: Cell[][];
}

/**
 * العناوين من تعريف الأعمدة لا من أول سطر: قسم بلا سطور (فترة بلا مبيعات) كان يُخرج ورقة
 * بلا أعمدة، فيسقط Excel بـ 500 ويخرج CSV بلا عناوين (ACFG-090، 2 نوفمبر 2026)
 */
function section<T>(name: string, items: readonly T[], columns: readonly Column<T>[]): Section {
  return { name, head: columns.map(([label]) => label), rows: items.map((x) => columns.map(([, value]) => value(x))) };
}

const s = (v: bigint | number | null | undefined) => (v === null || v === undefined ? '0' : v.toString());

/**
 * التقارير — AD-03 و AD-25. بوابة 11 البند الثاني: **كل رقم مالي يُقرأ من
 * الدفتر** (ledger_entries و platform_ledger_entries والاستردادات) لا من
 * جداول الطلبات، فالتقرير والدفتر مصدر واحد لا مصدران يتباعدان.
 *
 * التجميع بالعملة دائماً (ADR-013)؛ «الموحَّد بالدولار» عرضٌ يذكر السعر
 * المستعمل بجانب كل رقم محوَّل، ولا يدخل أي دفتر.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async financial(r: Range) {
    const [sales, refunds, platform, vendor, payouts, spread, active, carts, paidOrders] = await Promise.all([
      // المبيعات بعملة الدفع — ما قبضته المنصة من المشترين
      this.prisma.$queryRaw<{ currency: string; orders: bigint; gross: bigint }[]>`
        SELECT "currency", COUNT(*)::bigint AS orders, SUM("grandTotalMinorUnits")::bigint AS gross
        FROM "orders" WHERE "paidAt" >= ${r.from} AND "paidAt" < ${r.to}
        GROUP BY "currency" ORDER BY "currency"`,
      this.prisma.$queryRaw<{ currency: string; refunded: bigint }[]>`
        SELECT o."currency", SUM(rf."amountMinorUnits")::bigint AS refunded
        FROM "refunds" rf JOIN "sub_orders" s ON s."id" = rf."subOrderId" JOIN "orders" o ON o."id" = s."orderId"
        WHERE rf."status" <> 'failed' AND rf."createdAt" >= ${r.from} AND rf."createdAt" < ${r.to}
        GROUP BY o."currency" ORDER BY o."currency"`,
      // نصيب المنصة من دفترها، بعملة البائع
      this.prisma.$queryRaw<{ currency: string; entryType: string; net: bigint }[]>`
        SELECT "currency", "entryType",
               SUM(CASE WHEN "direction" = 'credit' THEN "amountMinorUnits" ELSE -"amountMinorUnits" END)::bigint AS net
        FROM "platform_ledger_entries" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to}
        GROUP BY "currency", "entryType"`,
      // حركة دفتر البائعين لكل نوع
      this.prisma.$queryRaw<{ currency: string; entryType: string; net: bigint }[]>`
        SELECT "currency", "entryType"::text AS "entryType",
               SUM(CASE WHEN "direction" = 'credit' THEN "amountMinorUnits" ELSE -"amountMinorUnits" END)::bigint AS net
        FROM "ledger_entries" WHERE "createdAt" >= ${r.from} AND "createdAt" < ${r.to}
        GROUP BY "currency", "entryType"`,
      this.prisma.$queryRaw<{ currency: string; paid: bigint }[]>`
        SELECT "currency", SUM("amountMinorUnits")::bigint AS paid FROM "payout_requests"
        WHERE "status" = 'paid' AND "paidAt" >= ${r.from} AND "paidAt" < ${r.to} GROUP BY "currency"`,
      // هامش الصرف: الفرق بين ما دُفع وما كان سيُدفع بلا هامش، للفرعيات بعملة مختلفة — على
      // هامش لحظة التسعير المحفوظ معه، لا الإعداد اليوم (ACFG-093). الإعداد لما لم تحمله لقطته وحده
      this.prisma.$queryRaw<{ currency: string; spread: bigint }[]>`
        SELECT o."currency",
               SUM(s."chargeTotalMinorUnits" - ROUND(s."chargeTotalMinorUnits" * 10000.0 /
                   (10000 + COALESCE(s."fxSpreadBpsSnapshot",
                     (SELECT ("valueJson" #>> '{}')::int FROM "settings" WHERE "key" = 'fx_spread_bps'), 0))))::bigint AS spread
        FROM "sub_orders" s JOIN "orders" o ON o."id" = s."orderId"
        WHERE o."paidAt" >= ${r.from} AND o."paidAt" < ${r.to} AND s."settlementCurrency" <> o."currency"
        GROUP BY o."currency"`,
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT "vendorId")::bigint AS n FROM "sub_orders" WHERE "placedAt" >= ${r.from} AND "placedAt" < ${r.to}`,
      this.prisma.cart.count({ where: { createdAt: { gte: r.from, lt: r.to } } }),
      this.prisma.order.count({ where: { paidAt: { gte: r.from, lt: r.to } } }),
    ]);

    const chargeCurrencies = [...new Set([...sales.map((x) => x.currency), ...refunds.map((x) => x.currency)])].sort();
    const bySales = chargeCurrencies.map((c) => {
      const sl = sales.find((x) => x.currency === c);
      const orders = sl?.orders ?? 0n;
      const gross = sl?.gross ?? 0n;
      return {
        currency: c,
        orders: Number(orders),
        grossMinorUnits: s(gross),
        refundedMinorUnits: s(refunds.find((x) => x.currency === c)?.refunded),
        averageOrderMinorUnits: s(orders > 0n ? gross / orders : 0n),
        fxSpreadMinorUnits: s(spread.find((x) => x.currency === c)?.spread),
      };
    });

    const ledgerCurrencies = [...new Set([...platform.map((x) => x.currency), ...vendor.map((x) => x.currency)])].sort();
    const net = (rows: { currency: string; entryType: string; net: bigint }[], c: string, t?: string) =>
      rows.filter((x) => x.currency === c && (!t || x.entryType === t)).reduce((a, x) => a + x.net, 0n);
    const byLedger = ledgerCurrencies.map((c) => ({
      currency: c,
      commissionMinorUnits: s(net(platform, c, 'commission')),
      taxHeldMinorUnits: s(net(platform, c, 'tax_held')),
      discountSubsidyMinorUnits: s(net(platform, c, 'discount_subsidy')),
      roundingMinorUnits: s(net(platform, c, 'rounding')),
      platformNetMinorUnits: s(net(platform, c)),
      vendorSalesMinorUnits: s(net(vendor, c, 'sale_credit') + net(vendor, c, 'shipping_credit')),
      vendorRefundsMinorUnits: s(-net(vendor, c, 'refund_debit')),
      vendorDuesNetMinorUnits: s(
        net(vendor, c) - net(vendor, c, 'payout_debit') - net(vendor, c, 'hold_release_out') - net(vendor, c, 'hold_release_in'),
      ),
      payoutsPaidMinorUnits: s(payouts.find((x) => x.currency === c)?.paid),
    }));

    return {
      range: { from: r.from, to: r.to },
      sales: bySales,
      ledger: byLedger,
      activeVendors: Number(active[0]?.n ?? 0n),
      conversion: { carts, paidOrders, ratePct: carts > 0 ? Math.round((paidOrders / carts) * 1000) / 10 : null },
      usd: await this.unified(bySales, byLedger),
    };
  }

  /** العرض الموحّد بالدولار — كل رقم بجانبه السعر الذي حُوِّل به */
  private async unified(
    sales: { currency: string; grossMinorUnits: string }[],
    ledger: { currency: string; commissionMinorUnits: string }[],
  ) {
    const rates = new Map<string, number>();
    for (const c of new Set([...sales.map((x) => x.currency), ...ledger.map((x) => x.currency)])) {
      if (c === 'USD') {
        rates.set(c, 1);
        continue;
      }
      const r = await this.prisma.exchangeRate.findFirst({
        where: { baseCode: 'USD', quoteCode: c },
        orderBy: { effectiveAt: 'desc' },
        select: { rate: true },
      });
      if (r) rates.set(c, Number(r.rate));
    }
    // التحويل بنواة المال — لا حساب عشري على مبلغ خارجها (حارس verify)
    const toUsd = (minor: string, c: string): string | null => {
      const rate = rates.get(c);
      if (!rate) return null;
      return toDecimalString(convert(money(BigInt(minor), c), 'USD', 1 / rate));
    };
    return {
      note: 'تحويل عرض فقط بآخر سعر مسجَّل — لا يدخل أي دفتر',
      rows: [
        ...sales.map((x) => ({ metric: 'المبيعات', currency: x.currency, rate: rates.get(x.currency) ?? null, usd: toUsd(x.grossMinorUnits, x.currency) })),
        ...ledger.map((x) => ({ metric: 'العمولة', currency: x.currency, rate: rates.get(x.currency) ?? null, usd: toUsd(x.commissionMinorUnits, x.currency) })),
      ],
    };
  }

  // ------------------------------------------------------------- التصدير

  private flatten(report: Awaited<ReturnType<ReportsService['financial']>>): Section[] {
    return [
      section('المبيعات', report.sales, [
        ['العملة', (x) => x.currency], ['الطلبات', (x) => x.orders], ['المقبوض', (x) => x.grossMinorUnits],
        ['المُسترد', (x) => x.refundedMinorUnits], ['متوسط الطلب', (x) => x.averageOrderMinorUnits], ['هامش الصرف', (x) => x.fxSpreadMinorUnits],
      ]),
      section('الدفتر', report.ledger, [
        ['العملة', (x) => x.currency], ['العمولة', (x) => x.commissionMinorUnits], ['ضريبة محصّلة', (x) => x.taxHeldMinorUnits],
        ['دعم الخصم', (x) => x.discountSubsidyMinorUnits], ['فرق التقريب', (x) => x.roundingMinorUnits], ['صافي المنصة', (x) => x.platformNetMinorUnits],
        ['مبيعات البائعين', (x) => x.vendorSalesMinorUnits], ['استردادات البائعين', (x) => x.vendorRefundsMinorUnits],
        ['صافي مستحقات البائعين', (x) => x.vendorDuesNetMinorUnits], ['سحوبات محوَّلة', (x) => x.payoutsPaidMinorUnits],
      ]),
      section('موحّد بالدولار', report.usd.rows, [
        ['المؤشّر', (x) => x.metric], ['العملة', (x) => x.currency], ['السعر المستعمل', (x) => x.rate], ['بالدولار', (x) => x.usd],
      ]),
    ];
  }

  async csv(r: Range): Promise<string> {
    const esc = csvCell;
    const parts: string[] = [`${esc('الفترة')},${esc(r.from.toISOString())},${esc(r.to.toISOString())}`, esc('المبالغ بالوحدات الصغرى لكل عملة')];
    for (const sec of this.flatten(await this.financial(r))) {
      parts.push('', esc(sec.name), sec.head.map(esc).join(','), ...sec.rows.map((row) => row.map(esc).join(',')));
    }
    return `﻿${parts.join('\r\n')}\r\n`;
  }

  async xlsx(r: Range): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Basta';
    for (const sec of this.flatten(await this.financial(r))) {
      const ws = wb.addWorksheet(sec.name, { views: [{ rightToLeft: true }] });
      ws.addRow(sec.head).font = { bold: true };
      for (const row of sec.rows) ws.addRow(row);
      ws.columns.forEach((c) => (c.width = 18));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ----------------------------------------------------------- اللوحة

  async dashboard(r: Range, withMoney: boolean) {
    const deadlineHours = Number((await this.prisma.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } }))?.valueJson) || 48;
    const [report, vendors, payouts, disputes, overdue, drift] = await Promise.all([
      withMoney ? this.financial(r) : Promise.resolve(null),
      this.prisma.vendor.count({ where: { status: 'in_review' } }),
      this.prisma.payoutRequest.count({ where: { status: { in: ['requested', 'approved'] } } }),
      this.prisma.dispute.count({ where: { status: { in: ['open', 'escalated'] } } }),
      this.prisma.subOrder.count({
        where: { status: 'awaiting_vendor', placedAt: { lt: acceptanceDueSince(deadlineHours, new Date()) } },
      }),
      this.drift(),
    ]);
    return {
      ...(report ?? { sales: null, ledger: null }),
      // لا طابور منتجات: النشر بلا مراجعة منذ 15 أكتوبر 2026
      queues: { vendors, payouts, disputes, overdueAcceptance: overdue },
      alerts: withMoney ? drift.filter((d) => d.rows > 0) : [],
    };
  }

  /** منظرات التدقيق — أي انحراف تنبيه أحمر في اللوحة */
  async drift(): Promise<{ view: string; rows: number }[]> {
    const views = [
      'audit_money_conservation', 'audit_wallet_drift', 'audit_withdrawn_drift', 'audit_sub_order_without_ledger',
      'audit_inventory_drift', 'audit_reservation_drift', 'audit_order_split_drift', 'audit_paid_without_split',
    ];
    const out: { view: string; rows: number }[] = [];
    for (const v of views) {
      const r = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${v}"`);
      out.push({ view: v, rows: r[0]?.n ?? 0 });
    }
    return out;
  }
}
