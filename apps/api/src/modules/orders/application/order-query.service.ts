import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TransferDetailsService } from '../../payments/public';
import { allocate } from '../../pricing/public';
import { AWAITING_TRANSFER } from './order-lifecycle.service';
import {
  STATUS_LABELS,
  allowedFor,
  type SubOrderStatus,
  type TransitionActor,
} from '../domain/state-machine';

const PAGE = 20;

const SUB_ORDER_DETAIL = {
  items: {
    select: {
      id: true,
      productId: true,
      productNameSnapshotAr: true,
      variantLabelSnapshot: true,
      skuSnapshot: true,
      imageKeySnapshot: true,
      unitPriceMinorUnits: true,
      qty: true,
      refundedQty: true,
      lineSubtotalMinorUnits: true,
      lineTotalMinorUnits: true,
      review: { select: { id: true, rating: true } },
    },
  },
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    select: { fromStatus: true, toStatus: true, actorRole: true, reason: true, createdAt: true },
  },
  shipment: {
    select: {
      carrierCode: true,
      trackingNumber: true,
      status: true,
      shippedAt: true,
      deliveredAt: true,
      events: {
        orderBy: { occurredAt: 'desc' },
        select: { code: true, descriptionAr: true, location: true, occurredAt: true },
      },
    },
  },
  returns: {
    orderBy: { requestedAt: 'desc' },
    select: { id: true, itemsJson: true, reasonCode: true, description: true, status: true, requestedAt: true },
  },
  refunds: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, amountMinorUnits: true, reason: true, status: true, transferReference: true, createdAt: true },
  },
  disputes: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, reasonCode: true, status: true, createdAt: true },
  },
  vendor: { select: { id: true, slug: true, nameAr: true } },
} satisfies Prisma.SubOrderInclude;

type SubOrderRow = Prisma.SubOrderGetPayload<{ include: typeof SUB_ORDER_DETAIL }>;

/**
 * قراءات الطلبات لثلاثة جماهير. **كل استعلام يحمل شرط مالكه في `where`**
 * — لا جلب ثم فحص (ADR-010): طلب غيرك «غير موجود» لا «ممنوع».
 */
@Injectable()
export class OrderQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransferDetailsService,
  ) {}

  // ---------------------------------------------- الإدارة: ردود بانتظار التحويل

  /**
   * الردود التي لا تخرج آلياً — الإدارة تحوّلها وتسجّل مرجعها. معها ما يلزم لتعرف
   * إلى أين: مرجع التحويل الوارد وملاحظة من أكّده (اسم المحوِّل أو حسابه)، والمشتري.
   * الأقدم أولاً: المشتري الذي ينتظر منذ أيام قبل من ألغى للتوّ.
   */
  async awaitingRefunds() {
    const rows = await this.prisma.refund.findMany({
      where: { status: AWAITING_TRANSFER },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        amountMinorUnits: true,
        reason: true,
        createdAt: true,
        subOrder: {
          select: {
            subOrderNumber: true,
            vendor: { select: { nameAr: true } },
            order: {
              select: {
                orderNumber: true,
                currency: true,
                shippingAddressSnapshot: true,
                customer: { select: { fullName: true, email: true } },
                payment: { select: { transferReference: true, transferNote: true } },
              },
            },
          },
        },
      },
    });
    return {
      items: rows.map((r) => {
        const o = r.subOrder.order;
        const address = o.shippingAddressSnapshot as { phone?: string } | null;
        return {
          id: r.id,
          amountMinorUnits: r.amountMinorUnits.toString(),
          currency: o.currency,
          reason: r.reason,
          createdAt: r.createdAt,
          orderNumber: o.orderNumber,
          subOrderNumber: r.subOrder.subOrderNumber,
          store: r.subOrder.vendor.nameAr,
          buyer: { name: o.customer?.fullName ?? null, email: o.customer?.email ?? null, phone: address?.phone ?? null },
          paidWith: { reference: o.payment?.transferReference ?? null, note: o.payment?.transferNote ?? null },
        };
      }),
    };
  }

  // ------------------------------------------------------------- البائع

  async vendorList(
    vendorId: string,
    q: { status?: readonly string[]; search?: string; page?: number },
  ): Promise<{ items: unknown[]; total: number; counts: Record<string, number> }> {
    const where: Prisma.SubOrderWhereInput = {
      vendorId,
      ...(q.status?.length ? { status: { in: q.status as SubOrderStatus[] } } : {}),
      ...(q.search ? { subOrderNumber: { contains: q.search.trim(), mode: 'insensitive' } } : {}),
    };
    const page = Math.max(1, q.page ?? 1);
    const [rows, total, grouped] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true,
          subOrderNumber: true,
          status: true,
          settlementCurrency: true,
          totalMinorUnits: true,
          vendorNetMinorUnits: true,
          placedAt: true,
          order: { select: { shippingAddressSnapshot: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.subOrder.count({ where }),
      this.prisma.subOrder.groupBy({ by: ['status'], where: { vendorId }, _count: true }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.subOrderNumber,
        status: r.status,
        statusLabel: STATUS_LABELS[r.status as SubOrderStatus],
        currency: r.settlementCurrency,
        totalMinorUnits: r.totalMinorUnits.toString(),
        netMinorUnits: r.vendorNetMinorUnits.toString(),
        placedAt: r.placedAt,
        itemCount: r._count.items,
        buyer: recipientOf(r.order.shippingAddressSnapshot),
      })),
      total,
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count])),
    };
  }

  async vendorDetail(vendorId: string, subOrderId: string): Promise<unknown> {
    const sub = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, vendorId },
      include: { ...SUB_ORDER_DETAIL, order: { select: { orderNumber: true, shippingAddressSnapshot: true, customerNote: true } } },
    });
    if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    return {
      ...present(sub, 'vendor'),
      orderNumber: sub.order.orderNumber,
      // البائع يرى عنوان الشحن لأنه يشحن — ولا يرى بريد المشتري ولا بطاقته
      shippingAddress: sub.order.shippingAddressSnapshot,
      customerNote: sub.order.customerNote,
      financials: {
        itemsSubtotalMinorUnits: sub.itemsSubtotalMinorUnits.toString(),
        shippingMinorUnits: sub.shippingMinorUnits.toString(),
        discountMinorUnits: sub.discountMinorUnits.toString(),
        commissionMinorUnits: sub.commissionMinorUnits.toString(),
        commissionRateBps: sub.commissionRateBpsSnapshot,
        netMinorUnits: sub.vendorNetMinorUnits.toString(),
      },
    };
  }

  // ------------------------------------------------------------ المشتري

  async customerList(userId: string, page = 1): Promise<{ items: unknown[]; total: number }> {
    // محاولات الدفع الفاشلة لا تُعدّ طلبات — إلا طلب التحويل: حجزه المشتري وينتظر
    // تحويله، أو أُلغي لأنه لم يحوّل، وعليه أن يرى ذلك في «طلباتي»
    const where: Prisma.OrderWhereInput = {
      customerUserId: userId,
      OR: [{ status: { notIn: ['pending_payment', 'payment_failed'] } }, { payment: { is: { method: 'bank_transfer' } } }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (Math.max(1, page) - 1) * PAGE,
        take: PAGE,
        select: {
          orderNumber: true,
          status: true,
          currency: true,
          grandTotalMinorUnits: true,
          placedAt: true,
          payment: { select: { status: true, failureCode: true, expiresAt: true } },
          subOrders: {
            select: {
              status: true,
              vendor: { select: { nameAr: true } },
              items: { select: { productNameSnapshotAr: true, imageKeySnapshot: true, qty: true }, take: 3 },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map((o) => ({
        number: o.orderNumber,
        status: o.status,
        currency: o.currency,
        grandTotalMinorUnits: o.grandTotalMinorUnits.toString(),
        placedAt: o.placedAt,
        payment: o.payment,
        stores: o.subOrders.map((s) => ({
          vendor: s.vendor.nameAr,
          status: s.status,
          statusLabel: STATUS_LABELS[s.status as SubOrderStatus],
          items: s.items,
        })),
      })),
      total,
    };
  }

  async customerDetail(userId: string, orderNumber: string): Promise<unknown> {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, customerUserId: userId },
      include: { subOrders: { include: SUB_ORDER_DETAIL, orderBy: { subOrderNumber: 'asc' } }, payment: true },
    });
    if (!order) throw new NotFoundError('الطلب غير موجود.', { orderNumber });
    const returnWindowDays = await this.returnWindow();
    const awaiting = order.status === 'pending_payment' && order.payment?.status === 'awaiting_transfer';
    const details = awaiting ? await this.transfers.read() : null;
    return {
      number: order.orderNumber,
      status: order.status,
      currency: order.currency,
      placedAt: order.placedAt,
      grandTotalMinorUnits: order.grandTotalMinorUnits.toString(),
      itemsSubtotalMinorUnits: order.itemsSubtotalMinorUnits.toString(),
      shippingTotalMinorUnits: order.shippingTotalMinorUnits.toString(),
      discountTotalMinorUnits: order.discountTotalMinorUnits.toString(),
      // الضريبة في الملخّص كما رآها عند الدفع — بدونها لا يبلغ مجموع الأسطر الإجمالي
      taxTotalMinorUnits: order.taxTotalMinorUnits.toString(),
      taxInclusive: (order.pricingSnapshot as { taxInclusive?: boolean } | null)?.taxInclusive ?? false,
      shippingAddress: order.shippingAddressSnapshot,
      paymentStatus: order.payment?.status ?? null,
      paymentMethod: order.payment?.method ?? null,
      // قبل التأكيد لا متاجر بعد: الطلب يُقسَّم حين يصل التحويل — فيُعرض كيف يحوّل
      ...(details
        ? {
            transfer: {
              reference: order.orderNumber,
              expiresAt: order.payment?.expiresAt ?? null,
              windowHours: details.windowHours,
              beneficiary: details.beneficiary,
              bank: details.bank,
              iban: details.iban,
              cliqAlias: details.cliqAlias,
            },
          }
        : {}),
      ...(order.status === 'payment_failed' && order.payment?.failureCode
        ? { paymentFailure: { code: order.payment.failureCode, message: order.payment.failureMessage ?? '' } }
        : {}),
      // ما رآه المشتري قبل التقسيم: أسطر اللقطة، ليعرف ماذا حجز
      ...(order.subOrders.length === 0 ? { lines: snapshotLines(order.pricingSnapshot) } : {}),
      // تتبّع لكل بائع: شحنة ومسار وحالة مستقلة — ST-19
      stores: order.subOrders.map((s) => {
        const base = present(s, 'customer');
        const charged = chargedLines(order.pricingSnapshot, s);
        return {
          ...base,
          // سطر القطعة بعملة الدفع قبل الضريبة والخصم — كما في «قيمة المنتجات» في الملخّص
          items: base.items.map((i, k) => ({ ...i, chargeSubtotalMinorUnits: (charged[k] ?? 0n).toString() })),
          chargeTotalMinorUnits: (s.chargeTotalMinorUnits ?? 0n).toString(),
          returnable:
            s.status === 'delivered' &&
            !!s.deliveredAt &&
            Date.now() - s.deliveredAt.getTime() <= returnWindowDays * 86_400_000,
          reviewable: s.status === 'delivered' || s.status === 'completed',
        };
      }),
    };
  }

  // ------------------------------------------------------------- الإدارة

  async adminDetail(orderNumber: string): Promise<unknown> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: { subOrders: { include: SUB_ORDER_DETAIL }, payment: true },
    });
    if (!order) throw new NotFoundError('الطلب غير موجود.', { orderNumber });
    return {
      number: order.orderNumber,
      status: order.status,
      currency: order.currency,
      grandTotalMinorUnits: order.grandTotalMinorUnits.toString(),
      paymentStatus: order.payment?.status ?? null,
      stores: order.subOrders.map((s) => present(s, 'admin')),
    };
  }

  private async returnWindow(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'return_window_days' } });
    const v = Number(row?.valueJson);
    return Number.isFinite(v) && v > 0 ? v : 14;
  }
}

function present(s: SubOrderRow, audience: TransitionActor) {
  const status = s.status as SubOrderStatus;
  return {
    id: s.id,
    number: s.subOrderNumber,
    status,
    statusLabel: STATUS_LABELS[status],
    // الأزرار مشتقّة من الجدول نفسه الذي يرفض على الخادم — لا قائمتان تتباعدان
    actions: allowedFor(status, audience).filter((to) => !(audience === 'customer' && to === 'return_requested')),
    currency: s.settlementCurrency,
    totalMinorUnits: s.totalMinorUnits.toString(),
    shippingMinorUnits: s.shippingMinorUnits.toString(),
    placedAt: s.placedAt,
    acceptedAt: s.acceptedAt,
    shippedAt: s.shippedAt,
    deliveredAt: s.deliveredAt,
    cancelReason: s.cancelReason,
    vendor: s.vendor,
    items: s.items.map((i) => ({
      ...i,
      unitPriceMinorUnits: i.unitPriceMinorUnits.toString(),
      lineSubtotalMinorUnits: i.lineSubtotalMinorUnits.toString(),
      lineTotalMinorUnits: i.lineTotalMinorUnits.toString(),
    })),
    history: s.statusHistory.map((h) => ({
      ...h,
      toLabel: STATUS_LABELS[h.toStatus as SubOrderStatus],
    })),
    shipment: s.shipment,
    returns: s.returns,
    // مرجع تحويل الردّ للمشتري والإدارة — حساب المشتري البنكي ليس شأن البائع
    refunds: s.refunds.map(({ transferReference, ...r }) => ({
      ...r,
      amountMinorUnits: r.amountMinorUnits.toString(),
      ...(audience === 'vendor' ? {} : { transferReference }),
    })),
    disputes: s.disputes,
  };
}

/**
 * أسطر الفرعي بعملة الدفع: بنوده المحوَّلة في لقطة التسعير (charge.items) موزّعةً
 * على أسطره بنسبة قيمتها — فمجموعها بنود المتجر في «قيمة المنتجات» بالضبط، كما في
 * السلة. طلب بلا لقطة: يُحوَّل مجموعه بلقطة صرف الفرعي.
 */
function chargedLines(
  snapshot: Prisma.JsonValue | null,
  s: { vendorId: string; fxRateSnapshot: Prisma.Decimal; items: readonly { lineSubtotalMinorUnits: bigint }[] },
): bigint[] {
  const subtotals = s.items.map((i) => i.lineSubtotalMinorUnits);
  const subs = (snapshot as { subOrders?: { vendorId?: string; charge?: { items?: string } }[] } | null)?.subOrders ?? [];
  const fromSnapshot = subs.find((x) => x.vendorId === s.vendorId)?.charge?.items;
  const rate = Number(s.fxRateSnapshot);
  const items =
    fromSnapshot !== undefined
      ? BigInt(fromSnapshot)
      : BigInt(Math.round(Number(subtotals.reduce((a, b) => a + b, 0n)) / (rate > 0 ? rate : 1)));
  return allocate(items, subtotals);
}

/** أسطر الطلب من لقطة التسعير — لطلب لم يُقسَّم بعد (ينتظر التحويل أو أُلغي قبله) */
function snapshotLines(snapshot: Prisma.JsonValue | null) {
  const subs = (snapshot as { subOrders?: { vendorNameAr?: string; lines?: { nameAr: string; variantLabel?: string | null; qty: number; imageKey?: string | null }[] }[] } | null)?.subOrders ?? [];
  return subs.flatMap((s) =>
    (s.lines ?? []).map((l) => ({
      store: s.vendorNameAr ?? null,
      name: l.nameAr,
      variantLabel: l.variantLabel ?? null,
      qty: l.qty,
      imageKey: l.imageKey ?? null,
    })),
  );
}

function recipientOf(snapshot: Prisma.JsonValue): string | null {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const name = (snapshot as Record<string, unknown>)['recipientName'];
    const city = (snapshot as Record<string, unknown>)['city'];
    return [name, city].filter((x) => typeof x === 'string').join(' — ') || null;
  }
  return null;
}
