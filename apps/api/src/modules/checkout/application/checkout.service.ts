import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictError,
  InsufficientStockError,
  InvalidInputError,
  NotFoundError,
  ReservationExpiredError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CartService } from '../../cart/public';
import { LedgerService } from '../../finance/public';
import { NotificationsService } from '../../notifications/public';
import { formatIn, format as formatMoney, money } from '../../../common/money/money';
import { InventoryService } from '../../inventory/public';
import {
  PAYMENT_PROVIDER,
  TransferDetailsService,
  type ChargeOutcome,
  type PaymentProvider,
  type TransferDetails,
} from '../../payments/public';
import { PricingService } from '../../pricing/public';
import { guestOrderKey, orderNumber, toSnapshot, type Snapshot } from '../domain/snapshot';
import { hoursAr } from '../../../common/arabic-count';
import { loadEnv } from '../../../common/config/env';

/**
 * طلبات مفتوحة بانتظار التحويل لكل مشترٍ. كل طلب منها يحجز قطعه طوال المهلة (يومان
 * افتراضياً)، فبلا حدّ يحجز حسابٌ واحد مخزون متجر كامل بطلبات لا يحوّل ثمنها.
 */
export const MAX_OPEN_TRANSFERS = 3;

// أسماء الشهور على طريقة مصر («أكتوبر» لا «تشرين الأول») — قرار صاحبة المشروع 14 نوفمبر 2026 (DISC-041)
const DEADLINE_FORMAT = new Intl.DateTimeFormat('ar-u-nu-latn', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

/** وجهة التحويل كما تُكتب في رسالة المشتري — سطر لكل ما ضُبط */
export function payToLines(d: TransferDetails): string {
  return [
    d.cliqAlias ? `كليك: ${d.cliqAlias}` : null,
    d.iban ? `IBAN: ${d.iban}` : null,
    d.bank ? `البنك: ${d.bank}` : null,
    d.beneficiary ? `المستفيد: ${d.beneficiary}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

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
  /** ما رآه المشتري تحت «ادفع» — لا يُخصم غيره */
  readonly expected: { readonly total: bigint; readonly currency: string };
  readonly userId: string | null;
  readonly guestEmail?: string | null;
  readonly guestPhone?: string | null;
  readonly note?: string | null;
}

export type OrderOutcome =
  | 'paid'
  | 'failed'
  | 'requires_action'
  /** محجوز بانتظار تحويل المشتري — لا مال بعد، والإدارة تؤكّد الوصول */
  | 'awaiting_transfer'
  /** لا نعرف بعد — المصالحة تحسمها. لا يُعرض للمشتري «فشل» ولا «نجح» */
  | 'pending';

/** ما يحتاجه المشتري ليحوّل: المبلغ بالضبط، والوجهة، والمرجع، والموعد */
export interface TransferInstructions {
  readonly reference: string;
  readonly expiresAt: Date | null;
  readonly windowHours: number;
  readonly beneficiary: string | null;
  readonly bank: string | null;
  readonly iban: string | null;
  readonly cliqAlias: string | null;
}

export interface OrderResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly outcome: OrderOutcome;
  readonly total: { minorUnits: string; currency: string };
  readonly subOrderCount: number;
  readonly actionUrl?: string;
  readonly failure?: { code: string; message: string };
  readonly transfer?: TransferInstructions;
  /** لطلب الضيف وحده: يُرسل في x-order-key لقراءة حالته (guestOrderKey) */
  readonly accessKey?: string;
  /** الكوبون الذي خصم من الطلب ومبلغ ما وفّره — لـ«تمّ طلبك» */
  readonly coupon?: { code: string; discount: { minorUnits: string; currency: string } };
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
    private readonly transfers: TransferDetailsService,
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

    // رمز لا يعرفه المزوّد يُرفض هنا: استثناء الدفع بعد الطلب يُقرأ «لا نعرف» فيبقى الطلب معلّقاً بحجزه
    this.provider.assertToken(input.paymentToken);

    if (this.provider.method === 'bank_transfer') await this.assertTransferOpen(input.userId);

    const cart = await this.carts.lines(input.cartToken, input.userId);
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
    /**
     * التسعير يُعاد هنا بعنوان الطلب وسلّته الآن، وقد يختلف عمّا رآه المشتري:
     * غيّر العنوان بعد «احسب الشحن»، أو تغيّر سعر أو سعر شحن أو كوبون، أو
     * عدّل السلة من تبويب آخر. خصم المبلغ الجديد بصمت خصمٌ لما لم يوافق عليه —
     * فيُرفض قبل أي حجز أو مال، ومعه الإجمالي الصحيح ليراه ويؤكّده.
     */
    if (quote.totals.total !== input.expected.total || cart.currency !== input.expected.currency) {
      throw new ConflictError('تغيّر الإجمالي منذ حسبته. راجع المبلغ الجديد ثم اضغط «ادفع».', {
        reason: 'TOTAL_CHANGED',
        total: quote.totals.total.toString(),
        currency: cart.currency,
      });
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
      // الطلب وحجز الكوبون معاً: كوبون استُنفد أو تجاوز حدّ صاحبه يُسقط الطلب قبل أي مال
      order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
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
                method: this.provider.method,
                status: 'pending',
              },
            },
          },
          select: { id: true, orderNumber: true },
        });
        if (quote.coupon) {
          await this.reserveCoupon(tx, quote.coupon.code, created.id, input.userId ?? null, quote.coupon.discountMinor);
        }
        return created;
        // انتظار قفل الكوبون تحت ضغط يتجاوز مهلة Prisma الافتراضية (2ث للاتصال و5ث للمعاملة)
        // فيسقط الطلب بخطأ داخلي — المهل نفسها التي تعطيها وحدة المخزون لأقفالها
      }, { maxWait: 10_000, timeout: 20_000 });
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

  /**
   * نجاح وصل متأخراً — المصالحة أو صفحة الطلب أو إشعار المزوّد — لا يعرف سلة «ادفع». كانت تبقى
   * بقطعها، فيرى المشتري ما دفع ثمنه ما زال فيها ويدفع ثانية: اشترى القميص مرتين هكذا في J-08
   * (CHK-069، 20 أكتوبر 2026). السلة من حجز الطلب (الحجز يحمل سلّته)، ويُطرح منها ما دُفع وحده.
   */
  private async removeBoughtFromCart(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { reservationIds: true } });
    if (!order || order.reservationIds.length === 0) return;
    const held = await this.prisma.stockReservation.findMany({
      where: { id: { in: order.reservationIds } },
      select: { cartId: true, variantId: true, qty: true },
    });
    const cartId = held.find((r) => r.cartId)?.cartId;
    if (!cartId) return;
    await this.carts.removeBought(cartId, held.map(({ variantId, qty }) => ({ variantId, qty })));
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
          else await this.removeBoughtFromCart(orderId).catch(() => undefined);
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
      case 'awaiting_transfer':
        await this.awaitTransfer(orderId);
        // الطلب محجوز باسمه: سلّة ممتلئة بعده تدعوه ليطلب القطع نفسها مرتين
        if (cartId) await this.carts.clear(cartId).catch(() => undefined);
        return;
      case 'unknown':
        return; // المصالحة تحسمها
    }
  }

  // ======================================================= التحويل اليدوي

  /**
   * قبل أي حجز: بيانات الحساب مضبوطة (وإلا يحجز الطلب ولا يعرف المشتري أين يحوّل)،
   * والمشتري تحت حدّ الطلبات المفتوحة.
   */
  private async assertTransferOpen(userId: string | null): Promise<void> {
    const details = await this.transfers.read();
    if (!details.ready) {
      this.logger.error('الدفع بالتحويل بلا بيانات حساب — اضبطها من الإدارة ← الإعدادات');
      throw new ConflictError('الدفع غير متاح الآن — نضبط بيانات التحويل. جرّب بعد قليل.', { reason: 'TRANSFER_NOT_CONFIGURED' });
    }
    if (!userId) return;
    const open = await this.prisma.order.count({
      where: { customerUserId: userId, status: 'pending_payment', payment: { is: { status: 'awaiting_transfer' } } },
    });
    if (open >= MAX_OPEN_TRANSFERS) {
      throw new ConflictError(
        `لديك ${MAX_OPEN_TRANSFERS} طلبات بانتظار التحويل. حوّل ثمن أحدها أو ألغِه من «طلباتي» قبل طلب جديد.`,
        { reason: 'TOO_MANY_OPEN_TRANSFERS' },
      );
    }
  }

  /**
   * الطلب ينتظر التحويل: موعد على الدفعة، وحجز القطع ممدود إليه، ورسالة بكيف يحوّل.
   * شرطيّ على «pending» — الإعادة (مفتاح عدم التكرار، المصالحة) لا تمدّ ولا تراسل مرتين.
   */
  private async awaitTransfer(orderId: string): Promise<void> {
    const details = await this.transfers.read();
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        orderNumber: true,
        placedAt: true,
        reservationIds: true,
        customerUserId: true,
        grandTotalMinorUnits: true,
        currency: true,
        customer: { select: { fullName: true } },
      },
    });
    const expiresAt = new Date(order.placedAt.getTime() + details.windowHours * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'awaiting_transfer', expiresAt },
      });
      if (count === 0) return;
      await this.inventory.extend(order.reservationIds, expiresAt, tx);
      await this.notifications.enqueue(
        {
          code: 'order_awaiting_transfer',
          userId: order.customerUserId,
          vars: {
            name: firstName(order.customer?.fullName),
            order_number: order.orderNumber,
            amount: formatMoney(money(order.grandTotalMinorUnits, order.currency)),
            pay_to: payToLines(details),
            deadline: DEADLINE_FORMAT.format(expiresAt),
            // لحظته نفسها: منها يُكتب الموعد بالإنجليزية لمن لغة حسابه الإنجليزية
            deadline_at: expiresAt.toISOString(),
            link: `/account/orders/${order.orderNumber}`,
          },
        },
        tx,
      );
      // ومن يؤكّد التحويلات يعرف: الطلب لا يصل المتاجر قبل تأكيده، ويُلغى آلياً بعد المهلة
      await this.notifications.enqueueAdmins(
        {
          code: 'admin_transfer_awaiting',
          permission: 'payouts.approve',
          vars: {
            order_number: order.orderNumber,
            amount: formatMoney(money(order.grandTotalMinorUnits, order.currency)),
            hours: String(details.windowHours),
            link: '/admin/transfers',
          },
        },
        tx,
      );
    });
  }

  /**
   * وصل التحويل — تؤكّده الإدارة بمرجعه من كشف البنك وبالمبلغ الذي وصل. هذا التأكيد
   * يقوم مقام إشعار البوابة: يقسّم الطلب ويقيّد للبائعين ويبلّغ الجميع، في معاملة
   * واحدة مع كتابة المرجع وسطر التدقيق. قبله لا رصيد لبائع من مال لم يُقبض.
   *
   * لا يُؤكَّد ما انتهت مهلته: الطلب يُلغى وقطعه عادت أو ستعود للمخزون، وإحياؤه
   * يبيع ما ربما بيع لغيره. يُردّ ذلك التحويل للمشتري من البنك.
   */
  async confirmTransfer(
    orderNumber: string,
    adminUserId: string,
    input: { reference: string; note?: string | null; receivedMinor: bigint },
    now: Date = new Date(),
  ): Promise<OrderResult> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        status: true,
        grandTotalMinorUnits: true,
        currency: true,
        reservationIds: true,
        pricingSnapshot: true,
        payment: { select: { id: true, status: true, expiresAt: true, transferReference: true } },
      },
    });
    if (!order?.payment) throw new NotFoundError('لا طلب بهذا الرقم.', { orderNumber });
    if (order.payment.transferReference) {
      throw new ConflictError(`أُكّد تحويل هذا الطلب من قبل بالمرجع ${order.payment.transferReference}.`);
    }
    if (order.payment.status !== 'awaiting_transfer' || order.status !== 'pending_payment') {
      throw new ConflictError('هذا الطلب لا ينتظر تحويلاً.', { status: order.status });
    }
    if (!order.payment.expiresAt || order.payment.expiresAt <= now) {
      throw new ConflictError(
        'انتهت مهلة هذا الطلب ويُلغى، والقطع تعود للمخزون. ردّ التحويل للمشتري من البنك، أو اطلب منه أن يطلب من جديد.',
        { reason: 'TRANSFER_EXPIRED' },
      );
    }
    if (input.receivedMinor !== order.grandTotalMinorUnits) {
      throw new InvalidInputError(
        `المبلغ الواصل لا يطابق الطلب (${formatIn(order.grandTotalMinorUnits, order.currency)}). لا تؤكّد إلا تحويلاً بالمبلغ كاملاً.`,
        { reason: 'AMOUNT_MISMATCH' },
      );
    }
    const reference = input.reference.trim();
    const note = input.note?.trim() || null;
    const paymentId = order.payment.id;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const { count } = await tx.payment.updateMany({
            where: { id: paymentId, status: 'awaiting_transfer', transferReference: null },
            data: { transferReference: reference, transferNote: note, confirmedBy: adminUserId, confirmedAt: now },
          });
          if (count === 0) throw new ConflictError('تغيّرت حالة الطلب للتوّ. حدّث الصفحة.');

          // حجز سقط قبل أن يُمدّ (خادم سقط بين الإنشاء والتمديد): يُحجز من جديد، والنقص يوقف التأكيد
          const active = await tx.stockReservation.count({ where: { id: { in: order.reservationIds }, status: 'active' } });
          if (active !== order.reservationIds.length) {
            await this.inventory.release(order.reservationIds, tx);
            const lines = (order.pricingSnapshot as unknown as Snapshot).subOrders.flatMap((s) => s.lines);
            const fresh = await this.inventory.reserve(
              { lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, label: l.nameAr })), orderId: order.id },
              tx,
            );
            await tx.order.update({ where: { id: order.id }, data: { reservationIds: fresh.reservations.map((r) => r.id) } });
          }

          if (!(await this.split(tx, order.id))) throw new ConflictError('تغيّرت حالة الطلب للتوّ. حدّث الصفحة.');
          await tx.auditLog.create({
            data: {
              actorUserId: adminUserId,
              actorRole: 'admin',
              action: 'payment.transfer_confirmed',
              entityType: 'Order',
              entityId: order.id,
              beforeJson: { paymentStatus: 'awaiting_transfer' },
              afterJson: {
                reference,
                note,
                amount: order.grandTotalMinorUnits.toString(),
                currency: order.currency,
              },
            },
          });
        },
        { timeout: 20_000 },
      );
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        const product = String(err.details?.['productName'] ?? '');
        throw new ConflictError(
          `لم يبقَ ما يكفي من «${product}» لهذا الطلب — لا تؤكّده. ردّ التحويل للمشتري من البنك.`,
          { reason: 'OUT_OF_STOCK' },
        );
      }
      throw err;
    }
    return this.result(order.id);
  }

  /** المشتري يلغي طلبه قبل أن يحوّل — قطعه تعود فوراً لا بعد يومين */
  async cancelAwaitingTransfer(orderNumber: string, userId: string): Promise<OrderResult> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true, customerUserId: true, status: true, payment: { select: { status: true } } },
    });
    if (!order || order.customerUserId !== userId) throw new NotFoundError('الطلب غير موجود.', { orderNumber });
    if (order.status !== 'pending_payment' || order.payment?.status !== 'awaiting_transfer') {
      throw new ConflictError('هذا الطلب لا ينتظر تحويلاً — إلغاؤه من صفحة الطلب لكل متجر.', { status: order.status });
    }
    if (!(await this.markFailed(order.id, 'canceled_by_customer', 'ألغيت الطلب قبل التحويل.'))) {
      throw new ConflictError('تغيّرت حالة الطلب للتوّ. حدّث الصفحة.');
    }
    return this.result(order.id);
  }

  /** انقضت المهلة بلا تحويل: يُختم الطلب، وتعود القطع والكوبون، ويُبلَّغ المشتري — مرة واحدة */
  private async expireTransfer(orderId: string): Promise<void> {
    const { windowHours } = await this.transfers.read();
    await this.markFailed(orderId, 'transfer_expired', `لم يصل التحويل خلال ${hoursAr(windowHours)}، فأُلغي الطلب وعادت القطع للمخزون.`, async (tx) => {
      const o = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { orderNumber: true, customerUserId: true, customer: { select: { fullName: true } } },
      });
      await this.notifications.enqueue(
        {
          code: 'transfer_expired',
          userId: o.customerUserId,
          vars: {
            name: firstName(o.customer?.fullName),
            order_number: o.orderNumber,
            hours: String(windowHours),
            link: `/account/orders/${o.orderNumber}`,
          },
        },
        tx,
      );
    });
  }

  // ============================================================== النجاح

  /**
   * التقسيم — ADR-003. يقع مرة واحدة، ولو وصل النجاح من ثلاثة مسارات معاً.
   * الحارس: تحديث الطلب مشروط بـ pending_payment داخل المعاملة نفسها التي
   * تنشئ الفرعية — فالثاني يجد صفراً ولا ينشئ شيئاً.
   */
  async markPaid(orderId: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction((tx) => this.split(tx, orderId), { timeout: 20_000 });
    } catch (err) {
      if (err instanceof ReservationExpiredError) return this.paidAfterExpiry(orderId);
      throw err;
    }
  }

  /** جسم التقسيم داخل معاملة المستدعي — markPaid، أو إعادة الحجز بعد دفع متأخر (paidAfterExpiry) */
  private async split(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
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
          fxSpreadBpsSnapshot: so.fxSpreadBps ?? null,
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
          name: firstName(paid.customer?.fullName),
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

    // الكوبون حُجز عند إنشاء الطلب (reserveCoupon) — يُسجَّل هنا لطلب سبق ذلك وحده
    if (snapshot.coupon) {
      const coupon = await tx.coupon.findUnique({ where: { code: snapshot.coupon.code }, select: { id: true } });
      const reserved = coupon
        ? await tx.couponRedemption.findUnique({ where: { couponId_orderId: { couponId: coupon.id, orderId } } })
        : null;
      if (coupon && !reserved) {
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, orderId, userId: order.customerUserId, discountMinorUnits: BigInt(snapshot.coupon.discountMinor) },
        });
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      }
    }
    return true;
  }

  // ============================================================= الكوبون

  /**
   * حجز استعمال الكوبون مع إنشاء الطلب، تحت قفل صفّه.
   *
   * كان الحدّ يُقرأ عند التسعير ويُزاد العدّاد بعد الدفع بلا شرط: عشرة طلبات
   * متزامنة ترى «بقي استعمال» كلها فتمرّ كلها. والحدّ لكل مستخدم يُتخطّى بالشراء
   * ضيفاً — لا هوية فيُعدّ عليها. الآن:
   *   · القفل يسلسل الطلبات على الكوبون الواحد، والعدّ بعده يرى من سبق
   *   · الاستعمال يُحجز بسطر redemption وزيادة العدّاد في معاملة الطلب نفسها،
   *     ويُحرَّر إن فشل الدفع أو أُلغي الطلب قبله (releaseCoupon)
   *   · كوبون بحدّ لكل مستخدم يطلب حساباً: الضيف يبدّل بريده كما يشاء، فلا
   *     حدّ يُفرض عليه
   */
  private async reserveCoupon(
    tx: Prisma.TransactionClient,
    code: string,
    orderId: string,
    userId: string | null,
    discountMinor: bigint,
  ): Promise<void> {
    const [c] = await tx.$queryRaw<
      { id: string; usageLimitTotal: number | null; usageLimitPerUser: number | null; usedCount: number }[]
    >`SELECT "id", "usageLimitTotal", "usageLimitPerUser", "usedCount" FROM "coupons" WHERE "code" = ${code} FOR UPDATE`;
    if (!c) throw new ConflictError('الكوبون غير صالح. أزله من السلة وأكمل الطلب.');
    if (c.usageLimitTotal !== null && c.usedCount >= c.usageLimitTotal) {
      throw new ConflictError('استُنفد الكوبون للتوّ. أزله من السلة وأكمل الطلب.', { code });
    }
    if (c.usageLimitPerUser !== null) {
      if (!userId) {
        throw new ConflictError('هذا الكوبون بعدد استعمالات لكل حساب — سجّل الدخول لتستعمله.', { code });
      }
      const used = await tx.couponRedemption.count({ where: { couponId: c.id, userId } });
      if (used >= c.usageLimitPerUser) {
        throw new ConflictError('استعملت هذا الكوبون بعدد مرّاته المسموح. أزله من السلة وأكمل الطلب.', { code });
      }
    }
    await tx.couponRedemption.create({
      data: { couponId: c.id, orderId, userId, discountMinorUnits: discountMinor },
    });
    await tx.coupon.update({ where: { id: c.id }, data: { usedCount: { increment: 1 } } });
  }

  /** طلب لم يُدفع (فشل أو أُلغي قبل الدفع) يعيد استعمال كوبونه — لا يُحسب على صاحبه ولا على الحدّ */
  private async releaseCoupon(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const held = await tx.couponRedemption.findMany({ where: { orderId }, select: { id: true, couponId: true } });
    for (const r of held) {
      const { count } = await tx.couponRedemption.deleteMany({ where: { id: r.id } });
      if (count > 0) {
        await tx.coupon.updateMany({ where: { id: r.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
      }
    }
  }

  /**
   * دُفع بعد انتهاء الحجز — المزوّد تأخّر أكثر من مهلة الحجز. المال عندنا
   * والقطع ربما بيعت لغيره. يُعاد الحجز: إن توفّر أُكمل الطلب، وإلا يُلغى
   * ويُردّ المال. **لا يبقى مدفوع بلا طلبات فرعية** (audit_paid_without_split).
   *
   * إشعاران متزامنان يصلان هنا معاً. كان كلٌّ يحجز ويقسّم أو يردّ وحده: يُكمل
   * الأول الطلب بالقطع الأخيرة، فيجد الثاني المخزون نافداً فيردّ المال ويختم
   * الدفع «مردوداً» بلا شرط — والطلب مدفوع والبائع يشحن. الآن:
   *   · قفل صف الطلب، وإعادة الحجز والتقسيم في معاملته — الثاني ينتظر ثم يجد
   *     الطلب محسوماً فيخرج بلا أثر
   *   · النفاد وحده يُلغي — خطأ قاعدة بيانات يُرمى فتعيد البوابة الإشعار، لا يُردّ
   *     المال لأن اتصالاً انقطع
   *   · الإلغاء شرطيّ على pending_payment تحت القفل نفسه، والردّ بمسار الدفع
   *     المتأخر: حجزٌ ثم مفتاح عدم تكرار، ولا «مردود» قبل أن يُردّ فعلاً
   */
  private async paidAfterExpiry(orderId: string): Promise<boolean> {
    const lockOrder = async (tx: Prisma.TransactionClient) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      return row?.status ?? null;
    };

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if ((await lockOrder(tx)) !== 'pending_payment') return false;
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { pricingSnapshot: true, reservationIds: true } });
          const lines = (order.pricingSnapshot as unknown as Snapshot).subOrders.flatMap((s) => s.lines);
          // الحجز الجديد يحمل سلة القديم — منه يُعرف ما يُطرح من السلة بعد الدفع (removeBoughtFromCart)
          const cart = await tx.stockReservation.findFirst({
            where: { id: { in: order.reservationIds }, cartId: { not: null } },
            select: { cartId: true },
          });
          const fresh = await this.inventory.reserve(
            { lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, label: l.nameAr })), orderId, cartId: cart?.cartId ?? null },
            tx,
          );
          await tx.order.update({ where: { id: orderId }, data: { reservationIds: fresh.reservations.map((r) => r.id) } });
          return this.split(tx, orderId);
        },
        { timeout: 20_000 },
      );
    } catch (err) {
      if (!(err instanceof InsufficientStockError)) throw err;
    }

    // نفد المخزون: المعاملة أُرجعت كلها. الإلغاء تحت قفل جديد وبشرط الحالة —
    // مسار متزامن ربما أكمل الطلب بين المعاملتين
    const canceled = await this.prisma.$transaction(async (tx) => {
      if ((await lockOrder(tx)) !== 'pending_payment') return false;
      await tx.order.update({ where: { id: orderId }, data: { status: 'canceled', canceledAt: new Date() } });
      await this.releaseCoupon(tx, orderId);
      return true;
    });
    if (canceled) {
      this.logger.warn(`الطلب ${orderId} دُفع بعد نفاد مخزونه — أُلغي ويُردّ المال`);
      const payment = await this.prisma.payment.findUnique({ where: { orderId }, select: { providerIntentId: true } });
      await this.refundLateCapture(orderId, payment?.providerIntentId ?? undefined);
    }
    return false;
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
    const outcome = await this.provider.refund(p.providerIntentId, p.amountMinorUnits, `late-capture:${paymentId}`);
    // التحويل اليدوي لا دفع متأخراً فيه: ما انتهت مهلته لا يُؤكَّد (confirmTransfer)
    if (outcome.status !== 'succeeded') throw new Error(`ردّ الدفع المتأخر ${paymentId} لا يتمّ آلياً عند ${this.provider.name}`);
    const { refundId } = outcome;

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

  /**
   * الفشل يحرّر الحجز ويختم الطلب — لا مخزون مستهلك ولا طلب معلّق بلا صاحب.
   * `after` يجري في المعاملة نفسها لمن ختمها فعلاً (إشعار انتهاء المهلة مرة واحدة).
   */
  async markFailed(
    orderId: string,
    code: string,
    message: string,
    after?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
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
      await this.releaseCoupon(tx, orderId);
      if (after) await after(tx);
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
      select: {
        status: true,
        placedAt: true,
        payment: { select: { providerIntentId: true, status: true, expiresAt: true, provider: true } },
      },
    });
    if (!order) throw new NotFoundError('الطلب غير موجود.', { orderId });
    if (order.status !== 'pending_payment') return this.outcomeOf(order.status);

    const intentId = order.payment?.providerIntentId;
    if (order.payment?.status === 'awaiting_transfer') {
      // لا طرف يُسأل: الوصول تؤكّده الإدارة، والمصالحة تحسم انقضاء المهلة وحده
      if (order.payment.expiresAt && order.payment.expiresAt <= now) await this.expireTransfer(orderId);
    } else if (intentId && order.payment?.provider !== this.provider.name) {
      // تفويض عند مزوّد غير الموصول: لا يُسأل عنه غيره، ولا يُخمَّن — يبقى حتى يُوصل.
      // سؤال الموصول كان يعيد «بانتظار التحويل» لدفعة بطاقة فيقلبها طلبَ تحويل
      this.logger.warn(`الطلب ${orderId} معلّق عند ${order.payment?.provider} والموصول ${this.provider.name}`);
    } else if (intentId) {
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

    const after = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, payment: { select: { status: true } } },
    });
    return after.status === 'pending_payment' && after.payment?.status === 'awaiting_transfer'
      ? 'awaiting_transfer'
      : this.outcomeOf(after.status);
  }

  /**
   * كل الطلبات المعلّقة أقدم من دقيقة — مهمة دورية (payment_reconcile_minutes).
   * ما ينتظر تحويلاً ولم تنقضِ مهلته لا يُمرّ عليه: لا جديد عنده، ومئات منه
   * (يومان لكل طلب) كانت ستملأ الدفعة فتحجب «لا نعرف» الذي ينتظر الحسم.
   */
  async reconcilePending(now: Date = new Date()): Promise<number> {
    const stale = await this.prisma.order.findMany({
      where: pendingToReconcile(now),
      select: { id: true },
      orderBy: { placedAt: 'asc' },
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
        discountTotalMinorUnits: true,
        pricingSnapshot: true,
        customerUserId: true,
        _count: { select: { subOrders: true } },
        payment: { select: { status: true, providerIntentId: true, failureCode: true, failureMessage: true, expiresAt: true } },
      },
    });
    const waiting = order.status === 'pending_payment' ? order.payment?.status : null;
    const outcome: OrderOutcome =
      waiting === 'requires_action' ? 'requires_action' : waiting === 'awaiting_transfer' ? 'awaiting_transfer' : this.outcomeOf(order.status);
    const details = outcome === 'awaiting_transfer' ? await this.transfers.read() : null;
    const couponCode = (order.pricingSnapshot as { coupon?: { code?: string } | null } | null)?.coupon?.code;

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      outcome,
      total: { minorUnits: order.grandTotalMinorUnits.toString(), currency: order.currency },
      subOrderCount: order._count.subOrders,
      ...(couponCode && order.discountTotalMinorUnits > 0n
        ? { coupon: { code: couponCode, discount: { minorUnits: order.discountTotalMinorUnits.toString(), currency: order.currency } } }
        : {}),
      // تصل النتيجة من وضع الطلب (أو أعاده بمفتاح عدم التكرار نفسه) أو من أثبت المفتاح
      ...(order.customerUserId ? {} : { accessKey: guestOrderKey(order.id, loadEnv().jwtAccessSecret) }),
      ...(outcome === 'requires_action' && order.payment?.providerIntentId
        ? { actionUrl: `/checkout/verify?intent=${order.payment.providerIntentId}` }
        : {}),
      ...(outcome === 'failed' && order.payment?.failureCode
        ? { failure: { code: order.payment.failureCode, message: order.payment.failureMessage ?? '' } }
        : {}),
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

/** ما تمرّ عليه المصالحة الدورية: معلّق أقدم من دقيقة، إلا ما ينتظر تحويلاً ولم تنقضِ مهلته */
export function pendingToReconcile(now: Date): Prisma.OrderWhereInput {
  return {
    status: 'pending_payment',
    placedAt: { lt: new Date(now.getTime() - 60_000) },
    NOT: { payment: { is: { status: 'awaiting_transfer', expiresAt: { gt: now } } } },
  };
}

/** الاسم الأول للتحية — `\s` لا `s`: كان يقصّ «Thomas» عند أول حرف s */
const firstName = (full: string | null | undefined): string => (full ?? '').trim().split(/\s+/)[0] || 'عميلنا';
