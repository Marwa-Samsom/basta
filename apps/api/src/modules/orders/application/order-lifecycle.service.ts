import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LedgerService } from '../../finance/public';
import { InventoryService } from '../../inventory/public';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../payments/public';
import { planFullRefund, planPartialRefund } from '../domain/refunds';
import {
  assertTransition,
  deriveParent,
  isCancellation,
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
      await tx.shipment.upsert({
        where: { subOrderId: sub.id },
        create: {
          subOrderId: sub.id,
          carrierCode: input.carrierCode ?? 'self',
          trackingNumber: input.tracking!.trim(),
          status: 'in_transit',
          shippedAt: now,
        },
        update: { trackingNumber: input.tracking!.trim(), status: 'in_transit', shippedAt: now },
      });
    }
    if (to === 'delivered' && from === 'shipped') {
      await tx.shipment.updateMany({ where: { subOrderId: sub.id }, data: { status: 'delivered', deliveredAt: now } });
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
    if (to === 'delivered' && from === 'return_requested') {
      await tx.returnRequest.updateMany({
        where: { subOrderId: sub.id, status: 'requested' },
        data: { status: 'rejected', resolvedBy: actor.userId, resolvedAt: now },
      });
    }

    await this.syncParent(tx, sub.orderId);
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
        fxRateSnapshot: true,
        chargeTotalMinorUnits: true,
        refunds: { select: { amountMinorUnits: true } },
        items: {
          select: { id: true, lineTotalMinorUnits: true, qty: true, refundedQty: true, commissionMinorUnits: true },
        },
      },
    });
    const plan = planPartialRefund({
      lines: sub.items.map((i) => ({
        orderItemId: i.id,
        lineTotalMinor: i.lineTotalMinorUnits,
        qty: i.qty,
        refundedQty: i.refundedQty,
        commissionMinor: i.commissionMinorUnits,
      })),
      returned: items,
      fxRateSnapshot: sub.fxRateSnapshot.toString(),
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
   */
  async executeRefund(refundId: string): Promise<boolean> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: { select: { providerIntentId: true, amountMinorUnits: true, id: true } } },
    });
    if (!refund || refund.status !== 'pending') return false;

    const claimed = await this.prisma.refund.updateMany({
      where: { id: refundId, status: 'pending' },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) return false;

    try {
      const result =
        refund.amountMinorUnits > 0n && refund.payment.providerIntentId
          ? await this.provider.refund(refund.payment.providerIntentId, refund.amountMinorUnits)
          : { refundId: 'none' };

      await this.prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: refundId },
          data: { status: 'succeeded', providerRefundId: result.refundId },
        });
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

        // الفرعي الملغى أو المرتجَع يصير «مُسترَداً» بعد نجاح الردّ فعلاً، لا قبله
        const sub = await tx.subOrder.findUniqueOrThrow({
          where: { id: refund.subOrderId },
          select: { id: true, orderId: true, vendorId: true, status: true },
        });
        const from = sub.status as SubOrderStatus;
        if (isCancellation(from) || from === 'returned') {
          assertTransition(from, 'refunded', 'system');
          await this.apply(tx, sub, from, 'refunded', { kind: 'system', userId: null }, {});
        }
      });
      return true;
    } catch (err) {
      this.logger.error(`تعذّر تنفيذ الاسترداد ${refundId}`, err as Error);
      await this.prisma.refund.updateMany({ where: { id: refundId, status: 'processing' }, data: { status: 'pending' } });
      return false;
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
    if (sub.status !== 'delivered' || !sub.deliveredAt) {
      throw new ConflictError('الإرجاع متاح بعد التسليم وحده.', { status: sub.status });
    }
    const window = await this.setting(this.prisma, 'return_window_days', 14);
    if (Date.now() - sub.deliveredAt.getTime() > window * 86_400_000) {
      throw new ConflictError(`انقضت مهلة الإرجاع (${window} يوماً من التسليم).`);
    }
    if (input.items.length === 0) throw new InvalidInputError('اختر قطعة واحدة على الأقل.');
    for (const i of input.items) {
      const line = sub.items.find((l) => l.id === i.orderItemId);
      if (!line) throw new InvalidInputError('سطر ليس في هذا الطلب.');
      if (i.qty < 1 || i.qty > line.qty - line.refundedQty) {
        throw new InvalidInputError(`الكمية المتاحة للإرجاع ${line.qty - line.refundedQty}.`);
      }
    }

    const ret = await this.prisma.returnRequest.create({
      data: {
        subOrderId,
        itemsJson: input.items as unknown as Prisma.InputJsonValue,
        reasonCode: input.reasonCode,
        description: input.description?.trim() || null,
        mediaKeys: [],
      },
      select: { id: true },
    });
    await this.transition(subOrderId, 'return_requested', { kind: 'customer', userId: customerUserId }, {
      reason: input.reasonCode,
    });
    return ret.id;
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
    return { id: ret.id, items: ret.itemsJson as unknown as { orderItemId: string; qty: number }[] };
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
