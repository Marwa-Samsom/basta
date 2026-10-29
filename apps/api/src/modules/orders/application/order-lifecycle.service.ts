import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { daysAr } from '../../../common/arabic-count';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { mergeReturnLines, RETURN_REASON_LABELS } from '../../../common/return-lines';
import { LedgerService } from '../../finance/public';
import { NotificationsService } from '../../notifications/public';
import { format as formatMoney, money } from '../../../common/money/money';
import { InventoryService } from '../../inventory/public';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../payments/public';
import { allocate } from '../../pricing/public';
import { planFullRefund, planPartialRefund, toCharge } from '../domain/refunds';
import {
  assertTransition,
  deriveParent,
  isCancellation,
  STATUS_LABELS,
  type SubOrderStatus,
  type TransitionActor,
} from '../domain/state-machine';

type Tx = Prisma.TransactionClient;

export interface ActorRef {
  readonly kind: TransitionActor;
  readonly userId: string | null;
  /** للتحقّق من الملكية: البائع يمسّ فرعياته، والمشتري طلباته */
  readonly vendorId?: string | null;
}

export interface TransitionInput {
  readonly reason?: string | null;
  readonly tracking?: string | null;
  readonly carrierCode?: string | null;
  /** للإرجاع المقبول: الطلب الذي تُعاد قطعه */
  readonly returnRequestId?: string | null;
  /** يُردّ كل ما بقي من الفرعي — حسم النزاع لصالح المشتري وحده يمرّره (refundForDispute) */
  readonly fullRefund?: boolean;
  /** لطلب الإرجاع: صفّه يُكتب في معاملة الانتقال نفسها — الطلب الخاسر في سباق لا يترك صفّاً */
  readonly returnRequest?: {
    readonly id: string;
    readonly items: readonly { orderItemId: string; qty: number }[];
    readonly reasonCode: string;
    readonly description: string | null;
  };
}

/**
 * مهلة التنفيذ: استرداد بقي processing أطول منها سقط منفّذه بين الحجز والتسجيل.
 * أطول بكثير من طلب بوابة واحد، فلا يُنتزع تنفيذٌ حيّ بطيء.
 */
export const REFUND_STALE_MS = 5 * 60_000;

/** ردّ لا يخرج آلياً (تحويل يدوي): ينتظر أن تحوّله الإدارة وتسجّل مرجعه — المهمة لا تعيده */
export const AWAITING_TRANSFER = 'awaiting_transfer';

/** «عالق»: processing حُجز قبل المهلة — أو بلا وقت حجز (صفوف ما قبل claimedAt) وقديم */
export function stalledRefund(now: Date): Prisma.RefundWhereInput {
  const before = new Date(now.getTime() - REFUND_STALE_MS);
  return {
    status: 'processing',
    OR: [{ claimedAt: { lt: before } }, { claimedAt: null, createdAt: { lt: before } }],
  };
}

const ROLE_OF: Readonly<Record<TransitionActor, Role | null>> = Object.freeze({
  vendor: 'vendor_owner',
  customer: 'customer',
  admin: 'admin',
  carrier: null,
  system: null,
});

/**
 * دورة حياة الطلب الفرعي — ORDER-STATES.md.
 *
 * أربع قواعد تحكم كل انتقال هنا:
 *   1. **الجدول يحكم**: `assertTransition` قبل أي كتابة.
 *   2. **شرط الحالة داخل الكتابة**: انتقالان متزامنان من الحالة نفسها لا يمرّان
 *      معاً — الثاني يجد صفراً ويسمع «تغيّرت الحالة».
 *   3. **سطر تاريخ وسطر تدقيق في المعاملة نفسها**: لا انتقال صامت (INV-09).
 *   4. **الأثر على المخزون في المعاملة نفسها** — والأثر على بوابة الدفع بعدها،
 *      لأن البوابة لا تشارك معاملاتنا: الاسترداد يُسجَّل «معلّقاً» أولاً ثم يُنفَّذ،
 *      فسقوط الخادم بينهما يترك استرداداً معروفاً تعيده المهمة، لا مالاً ضائعاً.
 */
@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger('OrderLifecycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async transition(
    subOrderId: string,
    to: SubOrderStatus,
    actor: ActorRef,
    input: TransitionInput = {},
  ): Promise<void> {
    const refundIds = await this.prisma.$transaction(
      async (tx) => {
        const sub = await tx.subOrder.findUnique({
          where: { id: subOrderId },
          select: {
            id: true,
            orderId: true,
            vendorId: true,
            status: true,
            order: { select: { customerUserId: true } },
          },
        });
        if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });

        // الملكية قبل الجدول: بائع يسأل عن طلب غيره يسمع «غير موجود» لا «غير مسموح»
        if (actor.kind === 'vendor' && sub.vendorId !== actor.vendorId) {
          throw new NotFoundError('الطلب غير موجود.', { subOrderId });
        }
        if (actor.kind === 'customer' && sub.order.customerUserId !== actor.userId) {
          throw new NotFoundError('الطلب غير موجود.', { subOrderId });
        }

        const from = sub.status as SubOrderStatus;
        assertTransition(from, to, actor.kind, input);
        return this.apply(tx, sub, from, to, actor, input);
      },
      { timeout: 20_000 },
    );

    // الاسترداد بعد الالتزام: البوابة خارج معاملتنا
    for (const id of refundIds) await this.executeRefund(id);
  }

  /**
   * حسم نزاع لصالح المشتري — يُردّ له ما بقي، ويصير الفرعي «مسترَداً».
   *
   * كان الحسم يغلق النزاع وحده: لا ردّ للمشتري، وإغلاقه يفكّ تجميد مال البائع
   * فيُحرَّر له. الآن كله معاملة واحدة: `close` (إغلاق النزاع، يمرّره صاحبه)،
   * وتسجيل الاسترداد وعكس قيوده، والانتقال — فإن فشل شيء بقي النزاع مفتوحاً
   * والمال مجمّداً. ثم يُنفَّذ الاسترداد بعد الالتزام بمفتاحه الثابت.
   */
  async refundForDispute(
    subOrderId: string,
    adminUserId: string,
    reason: string,
    close: (tx: Tx) => Promise<void>,
  ): Promise<void> {
    const refundIds = await this.prisma.$transaction(
      async (tx) => {
        await close(tx);
        await tx.$queryRaw`SELECT 1 FROM "sub_orders" WHERE "id" = ${subOrderId}::uuid FOR UPDATE`;
        const sub = await tx.subOrder.findUnique({
          where: { id: subOrderId },
          select: { id: true, orderId: true, vendorId: true, status: true },
        });
        if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
        const from = sub.status as SubOrderStatus;
        if (from === 'refunded') return []; // رُدّ كله من قبل — لا شيء يبقى
        assertTransition(from, 'refunded', 'system', { reason });
        return this.apply(tx, sub, from, 'refunded', { kind: 'system', userId: adminUserId }, { reason, fullRefund: true });
      },
      { timeout: 20_000 },
    );
    for (const id of refundIds) await this.executeRefund(id);
  }

  /** الانتقال داخل معاملة قائمة. يعيد معرّفات استردادات سُجّلت لتُنفَّذ بعد الالتزام. */
  private async apply(
    tx: Tx,
    sub: { id: string; orderId: string; vendorId: string },
    from: SubOrderStatus,
    to: SubOrderStatus,
    actor: ActorRef,
    input: TransitionInput,
  ): Promise<string[]> {
    const now = new Date();
    const data: Prisma.SubOrderUpdateManyMutationInput = { status: to };
    if (to === 'accepted') data.acceptedAt = now;
    if (to === 'shipped') data.shippedAt = now;
    if (to === 'completed') data.completedAt = now;
    if (to === 'delivered' && from === 'shipped') {
      data.deliveredAt = now;
      data.holdReleaseAt = new Date(now.getTime() + (await this.setting(tx, 'hold_period_days', 14)) * 86_400_000);
    }
    if (isCancellation(to)) {
      data.canceledAt = now;
      data.cancelReason = input.reason?.trim() || null;
    }

    const { count } = await tx.subOrder.updateMany({ where: { id: sub.id, status: from }, data });
    if (count === 0) throw new ConflictError('تغيّرت حالة الطلب للتوّ. حدّث الصفحة.', { subOrderId: sub.id });

    await tx.subOrderStatusHistory.create({
      data: {
        subOrderId: sub.id,
        fromStatus: from,
        toStatus: to,
        actorUserId: actor.userId,
        actorRole: ROLE_OF[actor.kind],
        reason: input.reason?.trim() || (actor.kind === 'system' ? 'إجراء آلي' : null),
      },
    });

    // بوابة 09 البند 4: كل تغيير حالة في سجل التدقيق باسم منفّذه ووقته — في
    // المعاملة نفسها، لا عبر AuditService الذي يبتلع الفشل: انتقال بلا سطر
    // تدقيق يجب ألا يُلتزم أصلاً
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorRole: ROLE_OF[actor.kind],
        action: `sub_order.${to}`,
        entityType: 'SubOrder',
        entityId: sub.id,
        beforeJson: { status: from },
        afterJson: { status: to, reason: input.reason ?? null, actor: actor.kind },
      },
    });

    const refunds: string[] = [];

    if (to === 'shipped') {
      const tracking = input.tracking!.trim();
      // رقم البوليصة الصادرة للطلب يبقى باسم شركتها؛ وغيره ما اختاره البائع — المكتوب بيده توصيل ذاتي.
      // كان التحديث يُبقي شركة الشحنة القديمة، فمرجعٌ كتبه البائع بعد «تعذّر» يصير «بسطة إكسبرس» (VOPS-035)
      const prior = await tx.shipment.findUnique({ where: { subOrderId: sub.id }, select: { trackingNumber: true, carrierCode: true } });
      const carrierCode = prior?.trackingNumber === tracking ? prior.carrierCode : (input.carrierCode ?? 'self');
      await tx.shipment.upsert({
        where: { subOrderId: sub.id },
        create: { subOrderId: sub.id, carrierCode, trackingNumber: tracking, status: 'in_transit', shippedAt: now },
        update: { carrierCode, trackingNumber: tracking, status: 'in_transit', shippedAt: now },
      });
    }
    if (to === 'delivered' && from === 'shipped') {
      await tx.shipment.updateMany({ where: { subOrderId: sub.id }, data: { status: 'delivered', deliveredAt: now } });
    }
    // بعد شرط الحالة أعلاه: طلبان متزامنان يكتب أحدهما صفّه، والآخر يُرفض قبل أن يكتب شيئاً
    if (to === 'return_requested' && input.returnRequest) {
      const r = input.returnRequest;
      await tx.returnRequest.create({
        data: {
          id: r.id,
          subOrderId: sub.id,
          itemsJson: r.items as unknown as Prisma.InputJsonValue,
          reasonCode: r.reasonCode,
          description: r.description,
          mediaKeys: [],
        },
      });
    }

    // الإلغاء: القطع تعود كلها، والمبلغ كله يُردّ
    if (isCancellation(to)) {
      await this.restock(tx, sub.id, null, 'cancel', actor.userId);
      refunds.push(await this.recordFullRefund(tx, sub.id, input.reason ?? 'إلغاء', actor.userId));
    }

    // الإرجاع المستلَم: القطع المرتجعة وحدها تعود، ونصيبها وحده يُردّ
    if (to === 'returned' && from === 'return_requested') {
      const ret = await this.acceptedReturn(tx, sub.id, input.returnRequestId ?? null);
      await this.restock(tx, sub.id, ret.items, 'return', actor.userId);
      refunds.push(await this.recordPartialRefund(tx, sub.id, ret.items, actor.userId));
      await tx.returnRequest.update({
        where: { id: ret.id },
        data: { status: 'received', resolvedBy: actor.userId, resolvedAt: now },
      });
    }
    // شحنة لم تصل وعادت للبائع: كل القطع تعود وكل المبلغ يُردّ
    if (to === 'returned' && from === 'delivery_failed') {
      await this.restock(tx, sub.id, null, 'return', actor.userId);
      refunds.push(await this.recordFullRefund(tx, sub.id, 'تعذّر التوصيل', actor.userId));
    }
    // حسم نزاع لصالح المشتري: ما بقي كله يُردّ (ما رُدّ من قبل بإرجاع جزئي يُطرح)،
    // والقطع لا تعود للمخزون — لم يستلمها البائع
    if (to === 'refunded' && input.fullRefund) {
      refunds.push(await this.recordFullRefund(tx, sub.id, input.reason ?? 'حسم نزاع لصالح المشتري', actor.userId));
    }
    if (to === 'delivered' && from === 'return_requested') {
      await tx.returnRequest.updateMany({
        where: { subOrderId: sub.id, status: 'requested' },
        // السبب على الطلب نفسه: يراه المشتري في بطاقته وإشعار الرفض (BUY-047)
        data: { status: 'rejected', resolvedBy: actor.userId, resolvedAt: now, resolutionNote: input.reason?.trim() || null },
      });
    }

    await this.syncParent(tx, sub.orderId);
    await this.notify(tx, sub.id, from, to, input);
    return refunds;
  }

  // ------------------------------------------------------------- المخزون

  /**
   * القطع تعود إلى المخزون بحركة موثّقة (cancel أو return) — لا تعديل صامت
   * لـ onHand. `items` فارغة تعني كل قطع الفرعي (الإلغاء).
   */
  private async restock(
    tx: Tx,
    subOrderId: string,
    items: readonly { orderItemId: string; qty: number }[] | null,
    reason: 'cancel' | 'return',
    actorUserId: string | null,
  ): Promise<void> {
    const lines = await tx.orderItem.findMany({
      where: { subOrderId },
      select: { id: true, variantId: true, qty: true, refundedQty: true },
      orderBy: { variantId: 'asc' }, // ترتيب الأقفال ثابت — ADR-006
    });
    for (const line of lines) {
      const qty = items
        ? (items.find((i) => i.orderItemId === line.id)?.qty ?? 0)
        : line.qty - line.refundedQty;
      if (qty <= 0) continue;
      await this.inventory.adjust(
        { variantId: line.variantId, change: { delta: qty } },
        { reason, refType: 'sub_order', refId: subOrderId, actorUserId },
        tx,
      );
    }
  }

  // ------------------------------------------------------------ الاسترداد

  private async recordFullRefund(tx: Tx, subOrderId: string, reason: string, by: string | null): Promise<string> {
    const sub = await tx.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      select: {
        totalMinorUnits: true,
        commissionMinorUnits: true,
        chargeTotalMinorUnits: true,
        orderId: true,
        refunds: { select: { amountMinorUnits: true } },
        items: { select: { id: true, qty: true } },
      },
    });
    const already = sub.refunds.reduce((a, r) => a + r.amountMinorUnits, 0n);
    const plan = planFullRefund({
      vendorTotalMinor: sub.totalMinorUnits,
      commissionMinor: sub.commissionMinorUnits,
      chargeTotalMinor: sub.chargeTotalMinorUnits ?? 0n,
      alreadyRefundedChargeMinor: already,
    });
    for (const item of sub.items) {
      await tx.orderItem.update({ where: { id: item.id }, data: { refundedQty: item.qty } });
    }
    const refundId = await this.createRefund(tx, subOrderId, sub.orderId, plan.chargeMinor, reason, by);
    // الدفتر في المعاملة نفسها: ما بقي للبائع وللمنصة يُعكس، والباقي للمشتري
    const posted = await this.ledger.postFullRefund(tx, subOrderId, refundId, by);
    await tx.refund.update({
      where: { id: refundId },
      data: { vendorAmountMinorUnits: posted.vendorAmount, ledgerEntryId: posted.ledgerEntryId },
    });
    return refundId;
  }

  private async recordPartialRefund(
    tx: Tx,
    subOrderId: string,
    items: readonly { orderItemId: string; qty: number }[],
    by: string | null,
  ): Promise<string> {
    const sub = await tx.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      select: {
        orderId: true,
        vendorId: true,
        fxRateSnapshot: true,
        chargeTotalMinorUnits: true,
        order: { select: { pricingSnapshot: true } },
        refunds: { select: { amountMinorUnits: true } },
        items: {
          select: { id: true, lineTotalMinorUnits: true, qty: true, refundedQty: true, commissionMinorUnits: true },
        },
      },
    });
    const totals = sub.items.map((i) => i.lineTotalMinorUnits);
    const charged = allocate(itemsCharge(sub, totals), totals);
    const plan = planPartialRefund({
      lines: sub.items.map((i, k) => ({
        orderItemId: i.id,
        lineTotalMinor: i.lineTotalMinorUnits,
        chargeMinor: charged[k] ?? 0n,
        qty: i.qty,
        refundedQty: i.refundedQty,
        commissionMinor: i.commissionMinorUnits,
      })),
      returned: items,
      chargeTotalMinor: sub.chargeTotalMinorUnits ?? 0n,
      alreadyRefundedChargeMinor: sub.refunds.reduce((a, r) => a + r.amountMinorUnits, 0n),
    });
    const refundId = await this.createRefund(tx, subOrderId, sub.orderId, plan.chargeMinor, 'إرجاع', by);
    // قبل زيادة refundedQty: الدفتر يتحقّق من الكمية المتاحة للإرجاع بنفسه
    const posted = await this.ledger.postPartialRefund(tx, subOrderId, items, refundId, by);
    await tx.refund.update({
      where: { id: refundId },
      data: { vendorAmountMinorUnits: posted.vendorAmount, ledgerEntryId: posted.ledgerEntryId },
    });
    for (const line of plan.lines) {
      await tx.orderItem.update({ where: { id: line.orderItemId }, data: { refundedQty: { increment: line.qty } } });
    }
    return refundId;
  }

  private async createRefund(
    tx: Tx,
    subOrderId: string,
    orderId: string,
    amount: bigint,
    reason: string,
    by: string | null,
  ): Promise<string> {
    const payment = await tx.payment.findUniqueOrThrow({ where: { orderId }, select: { id: true } });
    const refund = await tx.refund.create({
      data: {
        subOrderId,
        paymentId: payment.id,
        amountMinorUnits: amount,
        reason,
        status: 'pending',
        requestedBy: by,
      },
      select: { id: true },
    });
    return refund.id;
  }

  /**
   * ينفّذ استرداداً معلّقاً عند البوابة. عديم الأثر عند التكرار: الشرط على
   * status = 'pending' داخل الكتابة. فشل البوابة يُبقيه معلّقاً فتعيده المهمة.
   *
   * **والإعادة لا تدفع مرتين.** البوابة قد تنجح ثم تسقط معاملتنا بعدها (خطأ
   * قاعدة، انتقال مرفوض، إشعار معطوب) فيعود الاسترداد معلّقاً وتعيده المهمة —
   * وكان يُرسَل بلا مفتاح فيُردّ المال مرة ثانية. المفتاح الآن معرّف الاسترداد
   * نفسه: كل إعادة له تسمع من البوابة الردّ الأول. ومعرّف ردّ البوابة يُكتب فور
   * نجاحها، قبل المعاملة، فيبقى أثر المال الخارج ولو سقط ما بعده.
   */
  async executeRefund(refundId: string, now: Date = new Date()): Promise<boolean> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: { select: { providerIntentId: true, amountMinorUnits: true, id: true, provider: true, method: true } } },
    });
    if (!refund || (refund.status !== 'pending' && refund.status !== 'processing')) return false;

    // المعلّق يُحجز، والعالق في processing بعد مهلة التنفيذ يُحجز من جديد: سقط منفّذه
    // بين الحجز والتسجيل. الشرط على claimedAt في الكتابة: مُعيدان معاً يحجز أحدهما
    const claimed = await this.prisma.refund.updateMany({
      where: { id: refundId, OR: [{ status: 'pending' }, stalledRefund(now)] },
      data: { status: 'processing', claimedAt: now },
    });
    if (claimed.count === 0) return false;

    try {
      /**
       * المال يعود من حيث جاء، لا من المزوّد الموصول الآن: ما دُفع بتحويل يُردّ بتحويل
       * ولو وُصلت بوابة بعده، وما دُفع عند بوابة لا يُرسل إلى غيرها (تفويضها لا يعرفه
       * سواها) — يبقى معلّقاً في السجل حتى تُوصل. بدّلت بيئة التطوير المزوّد مرة فصارت
       * ردود دفعات بالبطاقة «بانتظار التحويل».
       */
      const owed = refund.amountMinorUnits > 0n && refund.payment.providerIntentId;
      if (owed && refund.payment.method !== 'bank_transfer' && refund.payment.provider !== this.provider.name) {
        throw new Error(`الدفعة عند ${refund.payment.provider} والموصول ${this.provider.name} — لا يُردّ عند غير من قبضه`);
      }
      const result =
        !owed
          ? ({ status: 'succeeded', refundId: 'none' } as const)
          : refund.payment.method === 'bank_transfer'
            ? ({ status: 'manual' } as const)
            : await this.provider.refund(refund.payment.providerIntentId!, refund.amountMinorUnits, `refund:${refundId}`);

      // لا يخرج المال آلياً (تحويل يدوي): ينتظر أن تحوّله الإدارة وتسجّل مرجعه.
      // لا إشعار ولا «مُسترَد» قبل ذلك، والمهمة لا تعيده — ليس متعثّراً بل ينتظر إنساناً
      if (result.status === 'manual') {
        await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.refund.updateMany({ where: { id: refundId, status: 'processing' }, data: { status: AWAITING_TRANSFER } });
          if (count === 0) return;
          // ومن يحوّل الردود يعرف أن مشترياً ينتظر ماله — كان الردّ ينتظر في القائمة وحده
          const o = await tx.subOrder.findUniqueOrThrow({
            where: { id: refund.subOrderId },
            select: { order: { select: { orderNumber: true, currency: true } } },
          });
          await this.notifications.enqueueAdmins(
            {
              code: 'admin_refund_awaiting_transfer',
              permission: 'payouts.approve',
              vars: {
                order_number: o.order.orderNumber,
                amount: formatMoney(money(refund.amountMinorUnits, o.order.currency)),
                link: '/admin/transfers',
              },
            },
            tx,
          );
        });
        return false;
      }

      await this.prisma.refund.updateMany({
        where: { id: refundId, status: 'processing' },
        data: { providerRefundId: result.refundId },
      });

      await this.prisma.$transaction(async (tx) => {
        // شرطيّ: منفّذ أبطأ أُعيد حجزه من تحته ربما سجّل النجاح قبله — لا إشعار ولا انتقال مرتين
        const { count } = await tx.refund.updateMany({
          where: { id: refundId, status: 'processing' },
          data: { status: 'succeeded', providerRefundId: result.refundId },
        });
        if (count === 0) return;
        await this.settled(tx, refund, { code: 'refund_issued' });
      });
      return true;
    } catch (err) {
      this.logger.error(`تعذّر تنفيذ الاسترداد ${refundId}`, err as Error);
      await this.prisma.refund.updateMany({ where: { id: refundId, status: 'processing' }, data: { status: 'pending' } });
      return false;
    }
  }

  /**
   * الإدارة حوّلت الردّ بنفسها — تسجّل مرجع التحويل الصادر، وعندها فقط يصير الردّ
   * «تمّ» ويُبلَّغ المشتري بالمرجع ويصير الفرعي «مُسترَداً». قبل ذلك لا يقول له شيءٌ
   * «رُدّ المبلغ». شرطيّ على الحالة: مديران يسجّلان معاً يمرّ أحدهما.
   */
  async recordRefundTransfer(refundId: string, adminUserId: string, reference: string): Promise<void> {
    const ref = reference.trim();
    await this.prisma.$transaction(
      async (tx) => {
        const refund = await tx.refund.findUnique({
          where: { id: refundId },
          include: { payment: { select: { id: true, amountMinorUnits: true } } },
        });
        if (!refund) throw new NotFoundError('الاسترداد غير موجود.', { refundId });
        const { count } = await tx.refund.updateMany({
          where: { id: refundId, status: AWAITING_TRANSFER },
          data: { status: 'succeeded', transferReference: ref, providerRefundId: `manual:${ref}`, approvedBy: adminUserId },
        });
        if (count === 0) throw new ConflictError('هذا الاسترداد لا ينتظر تحويلاً — ربما سُجّل للتوّ. حدّث الصفحة.');
        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            actorRole: 'admin',
            action: 'refund.transfer_recorded',
            entityType: 'Refund',
            entityId: refundId,
            beforeJson: { status: AWAITING_TRANSFER },
            afterJson: { status: 'succeeded', reference: ref, amount: refund.amountMinorUnits.toString() },
          },
        });
        await this.settled(tx, refund, { code: 'refund_transferred', reference: ref });
      },
      { timeout: 20_000 },
    );
  }

  /**
   * ما بعد خروج المال — من البوابة أو بتحويل الإدارة: إشعار المشتري، وحالة الدفعة،
   * والفرعي الملغى أو المرتجَع يصير «مُسترَداً» بعد نجاح الردّ فعلاً، لا قبله.
   */
  private async settled(
    tx: Tx,
    refund: { subOrderId: string; amountMinorUnits: bigint; payment: { id: string; amountMinorUnits: bigint } },
    notice: { code: 'refund_issued' } | { code: 'refund_transferred'; reference: string },
  ): Promise<void> {
    const o = await tx.subOrder.findUniqueOrThrow({
      where: { id: refund.subOrderId },
      select: { order: { select: { orderNumber: true, currency: true, customerUserId: true, customer: { select: { fullName: true } } } } },
    });
    await this.notifications.enqueue(
      {
        code: notice.code,
        userId: o.order.customerUserId,
        vars: {
          name: firstName(o.order.customer?.fullName),
          order_number: o.order.orderNumber,
          amount: formatMoney(money(refund.amountMinorUnits, o.order.currency)),
          link: `/account/orders/${o.order.orderNumber}`,
          ...(notice.code === 'refund_transferred' ? { reference: notice.reference } : {}),
        },
      },
      tx,
    );
    const total = await tx.refund.aggregate({
      where: { paymentId: refund.payment.id, status: 'succeeded' },
      _sum: { amountMinorUnits: true },
    });
    await tx.payment.update({
      where: { id: refund.payment.id },
      data: {
        status: (total._sum.amountMinorUnits ?? 0n) >= refund.payment.amountMinorUnits ? 'refunded' : 'partially_refunded',
      },
    });

    const sub = await tx.subOrder.findUniqueOrThrow({
      where: { id: refund.subOrderId },
      select: { id: true, orderId: true, vendorId: true, status: true },
    });
    const from = sub.status as SubOrderStatus;
    // إرجاع جزئي: بقيت قطع عند المشتري فيعود الفرعي «تم التسليم»، لا «مُسترَد» نهائياً
    const kept =
      from === 'returned' &&
      (await tx.orderItem.findMany({ where: { subOrderId: sub.id }, select: { qty: true, refundedQty: true } })).some(
        (i) => i.refundedQty < i.qty,
      );
    if (kept) {
      const reason = 'رُدّ نصيب المرتجع وبقيت قطع لم تُرجع';
      assertTransition(from, 'delivered', 'system', { reason });
      await this.apply(tx, sub, from, 'delivered', { kind: 'system', userId: null }, { reason });
    } else if (isCancellation(from) || from === 'returned') {
      assertTransition(from, 'refunded', 'system');
      await this.apply(tx, sub, from, 'refunded', { kind: 'system', userId: null }, {});
    }
  }

  // ------------------------------------------------------------- الإرجاع

  /**
   * طلب إرجاع — ST-20. داخل مهلة الإرجاع من التسليم (Q-08)، ولقطع موجودة في
   * الطلب بكميات لم تُرجع من قبل.
   */
  async requestReturn(
    subOrderId: string,
    customerUserId: string,
    input: { items: { orderItemId: string; qty: number }[]; reasonCode: string; description?: string | null },
  ): Promise<string> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        status: true,
        deliveredAt: true,
        order: { select: { customerUserId: true } },
        items: { select: { id: true, qty: true, refundedQty: true } },
      },
    });
    if (!sub || sub.order.customerUserId !== customerUserId) {
      throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    }
    // كان كل ما ليس «تم التسليم» يسمع «الإرجاع متاح بعد التسليم وحده» — والطلب مسلَّم وله إرجاع قائم
    if (sub.status === 'return_requested') {
      throw new ConflictError('لهذا المتجر طلب إرجاع قائم — انتظر ردّ المتجر عليه، ثم اطلب إرجاع غيره.', { status: sub.status });
    }
    if (sub.status === 'returned') {
      throw new ConflictError('استلم المتجر مرتجعك ويُردّ مبلغه الآن — اطلب إرجاع غيره بعد أن يُردّ.', { status: sub.status });
    }
    if (sub.status !== 'delivered' || !sub.deliveredAt) {
      throw new ConflictError('الإرجاع متاح بعد التسليم وحده.', { status: sub.status });
    }
    const window = await this.setting(this.prisma, 'return_window_days', 14);
    if (Date.now() - sub.deliveredAt.getTime() > window * 86_400_000) {
      throw new ConflictError(`انقضت مهلة الإرجاع (${daysAr(window)} من التسليم).`);
    }
    if (input.items.length === 0) throw new InvalidInputError('اختر قطعة واحدة على الأقل.');
    if (input.items.some((i) => !Number.isInteger(i.qty) || i.qty < 1)) {
      throw new InvalidInputError('كمية الإرجاع عدد موجب.');
    }
    // السطر المكرّر مجموعاً: 2 + 2 من سطر فيه 3 أربع قطع لا قطعتان مرتين (BUY-044)
    const items = mergeReturnLines(input.items);
    for (const i of items) {
      const line = sub.items.find((l) => l.id === i.orderItemId);
      if (!line) throw new InvalidInputError('سطر ليس في هذا الطلب.');
      if (i.qty > line.qty - line.refundedQty) {
        throw new InvalidInputError(`الكمية المتاحة للإرجاع ${line.qty - line.refundedQty}.`);
      }
    }

    // كان الصفّ يُكتب قبل الانتقال وخارج معاملته: الطلب الخاسر في سباق يُرفض ويبقى صفّه
    // «requested» يتيماً — مكرَّراً عند الإدارة، ومانعاً تحرير رصيد البائع (J-05)
    const id = randomUUID();
    await this.transition(subOrderId, 'return_requested', { kind: 'customer', userId: customerUserId }, {
      // بالعربي في السجلّ وإشعار البائع؛ الرمز يبقى على طلب الإرجاع نفسه
      reason: RETURN_REASON_LABELS[input.reasonCode] ?? input.reasonCode,
      returnRequest: {
        id,
        items,
        reasonCode: input.reasonCode,
        description: input.description?.trim() || null,
      },
    });
    return id;
  }

  private async acceptedReturn(
    tx: Tx,
    subOrderId: string,
    returnRequestId: string | null,
  ): Promise<{ id: string; items: { orderItemId: string; qty: number }[] }> {
    const ret = await tx.returnRequest.findFirst({
      where: { subOrderId, status: 'requested', ...(returnRequestId ? { id: returnRequestId } : {}) },
      orderBy: { requestedAt: 'desc' },
    });
    if (!ret) throw new ConflictError('لا طلب إرجاع قائم لهذا الطلب.', { subOrderId });
    // طلب حُفظ قبل جمع المكرّر يصل مجموعاً: الاسترداد يقيس المتاح على مجموع السطر فيرفض الزائد
    return { id: ret.id, items: mergeReturnLines(ret.itemsJson as unknown as { orderItemId: string; qty: number }[]) };
  }

  // ------------------------------------------------------------ الإشعار

  /**
   * ما يهمّ المشتري من الانتقالات يُبلَّغ به، في معاملة الانتقال نفسها
   * (صندوق صادر). الانتقالات الداخلية (قبول، تجهيز) تظهر في صفحة التتبّع
   * ولا تستحقّ رسالة — الإغراق بالإشعارات يعلّم المشتري تجاهلها.
   */
  private async notify(tx: Tx, subOrderId: string, from: SubOrderStatus, to: SubOrderStatus, input: TransitionInput) {
    const s = await tx.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      select: {
        subOrderNumber: true,
        vendorId: true,
        vendor: { select: { nameAr: true } },
        order: { select: { orderNumber: true, customerUserId: true, customer: { select: { fullName: true } } } },
        shipment: { select: { carrierCode: true, trackingNumber: true } },
      },
    });
    const common = {
      name: firstName(s.order.customer?.fullName),
      order_number: s.order.orderNumber,
      store_name: s.vendor.nameAr,
      link: `/account/orders/${s.order.orderNumber}`,
    };
    // الرقم من صفّ الشحنة الذي كُتب للتوّ في المعاملة نفسها — إعادة الشحن بعد «تعذّر» تمرّ هنا أيضاً.
    // مرجع التوصيل الذاتي يكتبه البائع لنفسه ولا يُتتبَّع في صفحة التتبّع، فلا يُسمّى «رقم تتبّع»
    if (to === 'shipped' && s.shipment) {
      const tracking_label = s.shipment.carrierCode === 'self' ? 'مرجع التوصيل' : 'رقم التتبّع';
      await this.notifications.enqueue(
        {
          code: 'order_shipped',
          userId: s.order.customerUserId,
          vars: { ...common, tracking_label, tracking_number: s.shipment.trackingNumber },
        },
        tx,
      );
    } else if (to === 'shipped' || to === 'delivered' || to === 'delivery_failed') {
      // العودة إلى «تم التسليم» بعد رفض إرجاع أو ردّ إرجاع جزئي ليست تسليماً: وصله ما يخصّه.
      // ورفض الإرجاع خبره «رُفض» وسببه — كانت الشارة ترجع «تم التسليم» بلا تفسير ولا إشعار (BUY-047)
      if (to === 'delivered' && from === 'return_requested') {
        await this.notifications.enqueue(
          { code: 'return_rejected', userId: s.order.customerUserId, vars: { ...common, reason: input.reason?.trim() || 'لم يذكر المتجر سبباً' } },
          tx,
        );
        return;
      }
      if (to === 'delivered' && from === 'returned') return;
      await this.notifications.enqueue({ code: 'order_status_changed', userId: s.order.customerUserId, vars: { ...common, status: STATUS_LABELS[to] } }, tx);
    }
    if (isCancellation(to) && to !== 'canceled_by_customer') {
      await this.notifications.enqueue(
        { code: 'order_canceled', userId: s.order.customerUserId, vars: { ...common, reason: input.reason?.trim() || STATUS_LABELS[to] } },
        tx,
      );
    }
    // البائع يعرف بإلغاء لم يقم به هو، فلا يجهّز ما أُلغي — J-03 (18 أكتوبر 2026)
    if (to === 'canceled_by_admin' || to === 'canceled_by_customer') {
      await this.notifications.enqueueVendor(
        {
          code: 'vendor_order_canceled',
          vendorId: s.vendorId,
          vars: {
            order_number: s.subOrderNumber,
            reason: input.reason?.trim() || (to === 'canceled_by_customer' ? 'ألغاه المشتري' : 'ألغته الإدارة'),
            link: `/vendor/orders/${subOrderId}`,
          },
        },
        tx,
      );
    }
    if (to === 'return_requested') {
      await this.notifications.enqueueVendor(
        { code: 'return_requested', vendorId: s.vendorId, vars: { order_number: s.subOrderNumber, reason: input.reason?.trim() || 'غير محدّد', link: `/vendor/orders/${subOrderId}` } },
        tx,
      );
    }
  }

  // ------------------------------------------------------------ الأب

  /** الأب مشتقّ من أبنائه بعد كل انتقال — لا يُحدَّث يدوياً أبداً (ORDER-STATES §2) */
  private async syncParent(tx: Tx, orderId: string): Promise<void> {
    const children = await tx.subOrder.findMany({ where: { orderId }, select: { status: true } });
    const status = deriveParent(children.map((c) => c.status as SubOrderStatus));
    await tx.order.update({
      where: { id: orderId },
      data: { status, ...(status === 'canceled' ? { canceledAt: new Date() } : {}) },
    });
  }

  private async setting(db: Tx | PrismaService, key: string, fallback: number): Promise<number> {
    const row = await db.setting.findUnique({ where: { key } });
    const value = Number(row?.valueJson);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}

/**
 * ما دفعه المشتري لقطع الفرعي بعملة الدفع (بعد الخصم وبالضريبة كما في أسطرها): مدفوع الفرعي
 * في اللقطة ناقص شحنه. طلب بلا لقطة: مجموع الأسطر محوَّلاً بلقطة صرف الفرعي.
 */
function itemsCharge(
  sub: { vendorId: string; fxRateSnapshot: Prisma.Decimal; order: { pricingSnapshot: Prisma.JsonValue } },
  lineTotals: readonly bigint[],
): bigint {
  type Snap = { subOrders?: { vendorId?: string; charge?: { total?: string; shipping?: string } }[] };
  const charge = (sub.order.pricingSnapshot as Snap | null)?.subOrders?.find((s) => s.vendorId === sub.vendorId)?.charge;
  if (charge?.total !== undefined && charge.shipping !== undefined) return BigInt(charge.total) - BigInt(charge.shipping);
  return toCharge(
    lineTotals.reduce((a, b) => a + b, 0n),
    sub.fxRateSnapshot.toString(),
  );
}

/** الاسم الأول للتحية — `\s` لا `s`: كان يقصّ «Thomas» عند أول حرف s */
const firstName = (full: string | null | undefined): string => (full ?? '').trim().split(/\s+/)[0] || 'عميلنا';
