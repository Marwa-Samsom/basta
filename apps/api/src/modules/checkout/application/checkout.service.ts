import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  ReservationExpiredError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CartService } from '../../cart/public';
import { LedgerService } from '../../finance/public';
import { NotificationsService } from '../../notifications/public';
import { format as formatMoney, money } from '../../../common/money/money';
import { InventoryService } from '../../inventory/public';
import { PAYMENT_PROVIDER, type ChargeOutcome, type PaymentProvider } from '../../payments/public';
import { PricingService } from '../../pricing/public';
import { orderNumber, toSnapshot, type Snapshot } from '../domain/snapshot';

export interface CheckoutAddress {
  readonly recipientName: string;
  readonly phone: string;
  readonly country: string;
  readonly region: string;
  readonly city: string;
  readonly area?: string | null;
  readonly street: string;
  readonly building?: string | null;
  readonly landmark?: string | null;
}

export interface PlaceOrderInput {
  readonly cartToken: string;
  /** يولّده المتصفّح مرة لكل محاولة دفع — إعادة الضغط لا تنشئ طلباً ثانياً (ADR-011) */
  readonly idempotencyKey: string;
  readonly address: CheckoutAddress;
  readonly paymentToken: string;
  readonly userId: string | null;
  readonly guestEmail?: string | null;
  readonly guestPhone?: string | null;
  readonly note?: string | null;
}

export type OrderOutcome =
  | 'paid'
  | 'failed'
  | 'requires_action'
  /** لا نعرف بعد — المصالحة تحسمها. لا يُعرض للمشتري «فشل» ولا «نجح» */
  | 'pending';

export interface OrderResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly outcome: OrderOutcome;
  readonly total: { minorUnits: string; currency: string };
  readonly subOrderCount: number;
  readonly actionUrl?: string;
  readonly failure?: { code: string; message: string };
}

/**
 * إتمام الشراء — المرحلة 08.
 *
 * التسلسل، وكل خطوة فيه تحرس بنداً من البوابة:
 *
 *   1. **حجز المخزون أولاً** (ADR-006). النقص يُكتشف قبل أن يُطلب مال — لا
 *      يدفع مشترٍ ثم يُقال له نفد.
 *   2. طلب أب بحالة pending_payment ولقطة تسعير — **بلا طلبات فرعية**.
 *   3. الدفع بمفتاح عدم تكرار = معرّف الطلب.
 *   4. النجاح وحده يثبّت الحجز ويقسّم الطلب (ADR-003). الفشل يحرّر الحجز
 *      ويختم الطلب payment_failed. «لا نعرف» يبقى معلّقاً بحجزه حتى تحسمه
 *      المصالحة أو ينتهي الحجز.
 *
 * كل انتقال شرطيّ على الحالة داخل الكتابة نفسها: إشعاران متزامنان بالنجاح،
 * أو نجاح ومصالحة معاً، لا ينتج عنهما تقسيمان.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger('Checkout');

  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  // ================================================================ الطلب

  async place(input: PlaceOrderInput): Promise<OrderResult> {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey)) {
      throw new InvalidInputError('مفتاح عدم التكرار غير صالح.');
    }

    // ADR-011: المفتاح نفسه يعيد الطلب نفسه — الضغط مرتين على «ادفع» لا يدفع مرتين
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return this.result(existing.id);

    if (!input.userId && !input.guestEmail && !input.guestPhone) {
      throw new InvalidInputError('الضيف يحتاج بريداً أو هاتفاً لنبلغه بطلبه.');
    }

    const cart = await this.carts.lines(input.cartToken);
    if (cart.items.length === 0) throw new InvalidInputError('السلة فارغة.');

    const quote = await this.pricing.quote({
      items: cart.items,
      currency: cart.currency,
      address: { country: input.address.country, region: input.address.region, city: input.address.city },
      couponCode: cart.couponCode,
      userId: input.userId,
    });
    if (quote.blockers.length > 0) {
      throw new ConflictError('لا يمكن إتمام الطلب بعد.', { blockers: quote.blockers });
    }

    // 1 · الحجز — يرمي InsufficientStockError باسم المنتج قبل أي مال
    const lines = quote.subOrders.flatMap((s) => s.lines);
    const reservation = await this.inventory.reserve({
      lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, label: l.nameAr })),
      cartId: cart.cartId,
    });
    const reservationIds = reservation.reservations.map((r) => r.id);

    // 2 · الطلب الأب بلقطته
    let order: { id: string; orderNumber: string };
    try {
      order = await this.prisma.order.create({
        data: {
          orderNumber: orderNumber(new Date()),
          customerUserId: input.userId,
          guestEmail: input.userId ? null : (input.guestEmail ?? null),
          guestPhone: input.userId ? null : (input.guestPhone ?? null),
          idempotencyKey: input.idempotencyKey,
          currency: quote.currency,
          itemsSubtotalMinorUnits: quote.totals.items,
          shippingTotalMinorUnits: quote.totals.shipping,
          discountTotalMinorUnits: quote.totals.discount,
          taxTotalMinorUnits: quote.totals.tax,
          grandTotalMinorUnits: quote.totals.total,
          status: 'pending_payment',
          shippingAddressSnapshot: { ...input.address } as Prisma.InputJsonValue,
          customerNote: input.note?.trim() || null,
          pricingSnapshot: toSnapshot(quote) as unknown as Prisma.InputJsonValue,
          reservationIds,
          payment: {
            create: {
              provider: this.provider.name,
              amountMinorUnits: quote.totals.total,
              currency: quote.currency,
              method: 'card',
              status: 'pending',
            },
          },
        },
        select: { id: true, orderNumber: true },
      });
    } catch (err) {
      // لا طلب بلا صاحب ولا حجز بلا طلب: فشل الإنشاء يحرّر الحجز فوراً
      await this.inventory.release(reservationIds);
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // سباق على المفتاح نفسه: الآخر سبق — نعيد طلبه
        const winner = await this.prisma.order.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        if (winner) return this.result(winner.id);
      }
      throw err;
    }

    // 3 · الدفع
    let outcome: ChargeOutcome;
    try {
      outcome = await this.provider.charge({
        idempotencyKey: order.id,
        orderId: order.id,
        amountMinor: quote.totals.total,
        currency: quote.currency,
        paymentToken: input.paymentToken,
      });
    } catch (err) {
      /**
       * استثناء من المزوّد (شبكة، مهلة) معناه «لا نعرف» لا «فشل»: قد يكون
       * المال خُصم. الطلب يبقى معلّقاً بحجزه، والمصالحة تسأل المزوّد.
       */
      this.logger.warn(`دفع الطلب ${order.orderNumber} بلا ردّ: ${(err as Error).message}`);
      outcome = { status: 'unknown', intentId: '' };
    }

    await this.apply(order.id, outcome, cart.cartId);
    return this.result(order.id);
  }

  /** تطبيق نتيجة الدفع — من الردّ المباشر، أو الإشعار، أو المصالحة. عديم الأثر عند التكرار. */
  async apply(orderId: string, outcome: ChargeOutcome, cartId?: string | null): Promise<void> {
    if (outcome.intentId) {
      await this.prisma.payment.updateMany({
        where: { orderId, providerIntentId: null },
        data: { providerIntentId: outcome.intentId },
      });
    }

    switch (outcome.status) {
      case 'captured':
        if (await this.markPaid(orderId)) {
          if (cartId) await this.carts.clear(cartId).catch(() => undefined);
          return;
        }
        // لم يُقسَّم: إمّا دُفع من قبل (إشعار مكرّر) وإمّا أُغلق قبل أن يصل المال
        await this.refundLateCapture(orderId, outcome.intentId);
        return;
      case 'failed':
        await this.markFailed(orderId, outcome.code, outcome.message);
        return;
      case 'requires_action':
        await this.prisma.payment.updateMany({
          where: { orderId, status: 'pending' },
          data: { status: 'requires_action' },
        });
        return;
      case 'unknown':
        return; // المصالحة تحسمها
    }
  }

  // ============================================================== النجاح

  /**
   * التقسيم — ADR-003. يقع مرة واحدة، ولو وصل النجاح من ثلاثة مسارات معاً.
   * الحارس: تحديث الطلب مشروط بـ pending_payment داخل المعاملة نفسها التي
   * تنشئ الفرعية — فالثاني يجد صفراً ولا ينشئ شيئاً.
   */
  async markPaid(orderId: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { count } = await tx.order.updateMany({
            where: { id: orderId, status: 'pending_payment' },
            data: { status: 'processing', paidAt: new Date() },
          });
          if (count === 0) return false;

          const order = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            select: {
              id: true,
              orderNumber: true,
              customerUserId: true,
              reservationIds: true,
              pricingSnapshot: true,
            },
          });

          await this.inventory.commit(order.reservationIds, { orderId }, tx);

          const snapshot = order.pricingSnapshot as unknown as Snapshot;
          const posted: { id: string; vendorId: string }[] = [];
          let n = 0;
          for (const so of snapshot.subOrders) {
            n++;
            const sub = await tx.subOrder.create({
              data: {
                orderId,
                vendorId: so.vendorId,
                subOrderNumber: `${order.orderNumber}-${n}`,
                settlementCurrency: so.currency,
                fxRateSnapshot: so.fxRateSnapshot,
                itemsSubtotalMinorUnits: BigInt(so.vendor.items),
                shippingMinorUnits: BigInt(so.vendor.shipping),
                discountMinorUnits: BigInt(so.vendor.discount),
                taxMinorUnits: BigInt(so.vendor.tax),
                totalMinorUnits: BigInt(so.vendor.total),
                commissionRateBpsSnapshot: so.lines[0]?.commissionBps ?? 0,
                commissionMinorUnits: BigInt(so.commissionMinor),
                vendorNetMinorUnits: BigInt(so.vendorNetMinor),
                chargeTotalMinorUnits: BigInt(so.charge.total),
                status: 'awaiting_vendor',
              },
              select: { id: true },
            });

            await tx.orderItem.createMany({
              data: so.lines.map((l) => ({
                subOrderId: sub.id,
                orderId,
                vendorId: so.vendorId,
                variantId: l.variantId,
                productId: l.productId,
                productNameSnapshotAr: l.nameAr,
                variantLabelSnapshot: l.variantLabel,
                skuSnapshot: l.sku,
                imageKeySnapshot: l.imageKey,
                unitPriceMinorUnits: BigInt(l.unitPriceMinor),
                qty: l.qty,
                lineSubtotalMinorUnits: BigInt(l.lineSubtotal),
                lineDiscountMinorUnits: BigInt(l.lineDiscount),
                lineTaxMinorUnits: BigInt(l.lineTax),
                lineTotalMinorUnits: BigInt(l.lineTotal),
                commissionBpsSnapshot: l.commissionBps,
                commissionMinorUnits: BigInt(l.commissionMinor),
              })),
            });

            await tx.subOrderStatusHistory.create({
              data: { subOrderId: sub.id, fromStatus: null, toStatus: 'awaiting_vendor', reason: 'نجح الدفع' },
            });
            posted.push({ id: sub.id, vendorId: so.vendorId });
          }

          // قيود البيع في معاملة التقسيم نفسها (ADR-005): فرعي بلا قيد لا يوجد.
          // بترتيب البائع لتُقفل المحافظ بترتيب ثابت — لا تعطّل متبادل بين طلبين
          for (const p of [...posted].sort((a, b) => a.vendorId.localeCompare(b.vendorId))) {
            await this.ledger.postSale(tx, p.id);
          }

          // الإشعارات في الصندوق الصادر ضمن المعاملة نفسها — تُرسل بعد الالتزام
          const paid = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            select: { grandTotalMinorUnits: true, currency: true, customer: { select: { fullName: true } } },
          });
          const deadline = await tx.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } });
          await this.notifications.enqueue(
            {
              code: 'order_placed',
              userId: order.customerUserId,
              vars: {
                name: (paid.customer?.fullName ?? 'عميلنا').split(/s+/)[0]!,
                order_number: order.orderNumber,
                amount: formatMoney(money(paid.grandTotalMinorUnits, paid.currency)),
                store_count: String(snapshot.subOrders.length),
                link: `/account/orders/${order.orderNumber}`,
              },
            },
            tx,
          );
          for (const [i, so] of snapshot.subOrders.entries()) {
            await this.notifications.enqueueVendor(
              {
                code: 'vendor_new_order',
                vendorId: so.vendorId,
                vars: {
                  order_number: `${order.orderNumber}-${i + 1}`,
                  amount: formatMoney(money(BigInt(so.vendor.total), so.currency)),
                  deadline_hours: String(Number(deadline?.valueJson) || 48),
                  link: '/vendor/orders',
                },
              },
              tx,
            );
          }

          await tx.payment.update({
            where: { orderId },
            data: { status: 'captured', authorizedAt: new Date(), capturedAt: new Date() },
          });

          if (snapshot.coupon) {
            const coupon = await tx.coupon.findUnique({ where: { code: snapshot.coupon.code } });
            if (coupon) {
              await tx.couponRedemption.create({
                data: {
                  couponId: coupon.id,
                  orderId,
                  userId: order.customerUserId,
                  discountMinorUnits: BigInt(snapshot.coupon.discountMinor),
                },
              });
              await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
            }
          }
          return true;
        },
        { timeout: 20_000 },
      );
    } catch (err) {
      if (err instanceof ReservationExpiredError) return this.paidAfterExpiry(orderId);
      throw err;
    }
  }

  /**
   * دُفع بعد انتهاء الحجز — المزوّد تأخّر أكثر من مهلة الحجز. المال عندنا
   * والقطع ربما بيعت لغيره. يُعاد الحجز: إن توفّر أُكمل الطلب، وإلا يُردّ
   * المال ويُلغى الطلب بسببه. **لا يبقى مدفوع بلا طلبات فرعية** (المنظر
   * audit_paid_without_split يثبت ذلك).
   */
  private async paidAfterExpiry(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { pricingSnapshot: true, payment: { select: { providerIntentId: true, amountMinorUnits: true } } },
    });
    const snapshot = order.pricingSnapshot as unknown as Snapshot;
    const lines = snapshot.subOrders.flatMap((s) => s.lines);
    try {
      const fresh = await this.inventory.reserve({
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, label: l.nameAr })),
        orderId,
      });
      await this.prisma.order.update({
        where: { id: orderId },
        data: { reservationIds: fresh.reservations.map((r) => r.id) },
      });
      return this.markPaid(orderId);
    } catch (err) {
      this.logger.error(`الطلب ${orderId} دُفع بعد نفاد مخزونه — يُردّ المال`, err as Error);
      if (order.payment?.providerIntentId) {
        await this.provider.refund(order.payment.providerIntentId, order.payment.amountMinorUnits);
      }
      await this.prisma.$transaction([
        this.prisma.order.updateMany({
          where: { id: orderId, status: 'pending_payment' },
          data: { status: 'canceled', canceledAt: new Date() },
        }),
        this.prisma.payment.updateMany({ where: { orderId }, data: { status: 'refunded' } }),
      ]);
      return false;
    }
  }

  // ========================================================== الدفع المتأخر

  /**
   * نجاح وصل لطلب أُغلق قبله — انتهت مهلة التحقق، أو حسمته المصالحة فاشلاً.
   * كان يُرمى بصمت (markPaid يشترط pending_payment): المال خُصم بلا طلب ولا ردّ.
   *
   * لا يُحيا الطلب: المشتري رأى «فشل» وربما طلب من جديد، وإحياؤه يشحن له
   * مرتين. يُردّ المال كله ويُبلَّغ. والشرط `paidAt IS NULL` هو الفاصل: طلب دُفع
   * ثم أُلغيت متاجره كلها صار canceled أيضاً، لكن ماله رُدّ بمساره — ردّه هنا ثانيةً
   * دفعٌ مرتين.
   *
   * مسار واحد يردّ: `lateCaptureAt` يُحجز بكتابة شرطية (إشعار ومصالحة معاً
   * يحجز أحدهما). ثم الردّ بمفتاح عدم تكرار، فإعادته بعد سقوطٍ لا تردّ مرتين.
   */
  private async refundLateCapture(orderId: string, intentId: string | undefined): Promise<void> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true, paidAt: true, payment: { select: { id: true, capturedAt: true, providerIntentId: true } } },
      });
      const payment = order?.payment;
      if (!order || !payment || order.paidAt || payment.capturedAt) return null;
      if (order.status !== 'payment_failed' && order.status !== 'canceled') return null;
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, lateCaptureAt: null, capturedAt: null },
        data: { lateCaptureAt: new Date(), ...(intentId && !payment.providerIntentId ? { providerIntentId: intentId } : {}) },
      });
      if (count === 0) return null;
      await tx.auditLog.create({
        data: {
          action: 'payment.late_capture',
          entityType: 'Order',
          entityId: orderId,
          afterJson: { orderStatus: order.status, intentId: intentId ?? payment.providerIntentId ?? null },
        },
      });
      return payment.id;
    });
    if (!claimed) return;
    this.logger.warn(`الطلب ${orderId} دُفع بعد إغلاقه (${intentId ?? '—'}) — يُردّ المال كله`);
    await this.settleLateRefund(claimed);
  }

  /** يردّ دفعاً متأخراً محجوزاً — ويُعاد بلا خطر من المصالحة إن سقط قبل أن يتمّ */
  private async settleLateRefund(paymentId: string): Promise<void> {
    const p = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        providerIntentId: true,
        amountMinorUnits: true,
        currency: true,
        lateRefundId: true,
        order: { select: { id: true, orderNumber: true, customerUserId: true } },
      },
    });
    if (p.lateRefundId) return;
    if (!p.providerIntentId) throw new Error(`دفع متأخر بلا تفويض — الطلب ${p.order.id}`);

    // المفتاح ثابت للدفعة: الإعادة بعد انقطاع تعيد الردّ الأول عند البوابة
    const { refundId } = await this.provider.refund(p.providerIntentId, p.amountMinorUnits, `late-capture:${paymentId}`);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, lateRefundId: null },
        data: { lateRefundId: refundId, status: 'refunded' },
      });
      if (count === 0) return;
      await tx.auditLog.create({
        data: {
          action: 'payment.late_capture_refunded',
          entityType: 'Order',
          entityId: p.order.id,
          afterJson: { refundId, amount: p.amountMinorUnits.toString(), currency: p.currency },
        },
      });
      await this.notifications.enqueue(
        {
          code: 'late_payment_refunded',
          userId: p.order.customerUserId,
          vars: { order_number: p.order.orderNumber, amount: formatMoney(money(p.amountMinorUnits, p.currency)) },
        },
        tx,
      );
    });
  }

  // =============================================================== الفشل

  /** الفشل يحرّر الحجز ويختم الطلب — لا مخزون مستهلك ولا طلب معلّق بلا صاحب */
  async markFailed(orderId: string, code: string, message: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'pending_payment' },
        data: { status: 'payment_failed' },
      });
      if (count === 0) return false;

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { reservationIds: true },
      });
      await this.inventory.release(order.reservationIds, tx);
      await tx.payment.update({
        where: { orderId },
        data: { status: 'failed', failureCode: code, failureMessage: message },
      });
      return true;
    });
  }

  // ============================================================ المصالحة

  /**
   * «لا نعرف» تُحسم هنا — بوابة 08 البند الرابع. تُسأل البوابة عن حقيقة
   * التفويض، ولا يُخمَّن. طلب بلا تفويض أصلاً (سقط الخادم قبل الإرسال) يُختم
   * فاشلاً بعد انتهاء مهلة حجزه: لم يُرسل طلب دفع، فلا مال خُصم.
   */
  async reconcile(orderId: string, now: Date = new Date()): Promise<OrderOutcome> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, placedAt: true, payment: { select: { providerIntentId: true } } },
    });
    if (!order) throw new NotFoundError('الطلب غير موجود.', { orderId });
    if (order.status !== 'pending_payment') return this.outcomeOf(order.status);

    const intentId = order.payment?.providerIntentId;
    if (intentId) {
      const truth = await this.provider.retrieve(intentId);
      if (truth.status === 'captured' || truth.status === 'failed') {
        await this.apply(orderId, truth);
      }
    } else {
      const ttl = await this.reservationTtlMinutes();
      if (now.getTime() - order.placedAt.getTime() > ttl * 60_000) {
        await this.markFailed(orderId, 'no_payment_attempt', 'لم يُرسل طلب الدفع إلى البوابة.');
      }
    }

    const after = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    return this.outcomeOf(after.status);
  }

  /** كل الطلبات المعلّقة أقدم من دقيقة — مهمة دورية (payment_reconcile_minutes) */
  async reconcilePending(now: Date = new Date()): Promise<number> {
    const stale = await this.prisma.order.findMany({
      where: { status: 'pending_payment', placedAt: { lt: new Date(now.getTime() - 60_000) } },
      select: { id: true },
      take: 200,
    });
    for (const o of stale) {
      await this.reconcile(o.id, now).catch((err: unknown) =>
        this.logger.error(`تعذّرت مصالحة الطلب ${o.id}`, err as Error),
      );
    }

    return stale.length + (await this.settleLateRefunds(now));
  }

  /** دفعات متأخرة حُجزت ولم يتمّ ردّها (سقطت البوابة أو الخادم بينهما) — المفتاح يمنع الردّ مرتين */
  async settleLateRefunds(now: Date = new Date()): Promise<number> {
    const unsettled = await this.prisma.payment.findMany({
      where: { lateCaptureAt: { not: null, lt: new Date(now.getTime() - 60_000) }, lateRefundId: null },
      select: { id: true },
      take: 50,
    });
    for (const p of unsettled) {
      await this.settleLateRefund(p.id).catch((err: unknown) =>
        this.logger.error(`تعذّر ردّ الدفع المتأخر ${p.id}`, err as Error),
      );
    }
    return unsettled.length;
  }

  // ============================================================ القراءة

  async result(orderId: string): Promise<OrderResult> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currency: true,
        grandTotalMinorUnits: true,
        _count: { select: { subOrders: true } },
        payment: { select: { status: true, providerIntentId: true, failureCode: true, failureMessage: true } },
      },
    });
    const outcome =
      order.payment?.status === 'requires_action' && order.status === 'pending_payment'
        ? 'requires_action'
        : this.outcomeOf(order.status);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      outcome,
      total: { minorUnits: order.grandTotalMinorUnits.toString(), currency: order.currency },
      subOrderCount: order._count.subOrders,
      ...(outcome === 'requires_action' && order.payment?.providerIntentId
        ? { actionUrl: `/checkout/verify?intent=${order.payment.providerIntentId}` }
        : {}),
      ...(outcome === 'failed' && order.payment?.failureCode
        ? { failure: { code: order.payment.failureCode, message: order.payment.failureMessage ?? '' } }
        : {}),
    };
  }

  private outcomeOf(status: string): OrderOutcome {
    if (status === 'pending_payment') return 'pending';
    if (status === 'payment_failed' || status === 'canceled') return 'failed';
    return 'paid';
  }

  private async reservationTtlMinutes(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'reservation_ttl_minutes' } });
    return Number(row?.valueJson ?? 15);
  }
}
