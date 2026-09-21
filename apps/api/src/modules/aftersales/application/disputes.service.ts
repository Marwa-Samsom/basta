import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/public';

/** حالات يُفتح فيها نزاع: بعد الشحن وحتى قبل الإكمال */
const DISPUTABLE = ['shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned'] as const;
const OPEN = ['open', 'escalated'];

export type Party =
  | { kind: 'customer'; userId: string }
  | { kind: 'vendor'; userId: string; vendorId: string }
  | { kind: 'admin'; userId: string };

const ROLE: Record<Party['kind'], Role> = { customer: 'customer', vendor: 'vendor_owner', admin: 'admin' };

/**
 * النزاعات — ST-21 · VD-17 · AD-12.
 *
 * نزاع مفتوح يجمّد إكمال الطلب وتحرير مال البائع (ADR-007): مهمة الإكمال
 * تتخطّى الفرعي ما دام له نزاع open أو escalated. التصعيد ينقله لطابور
 * الإدارة، والحسم بصلاحية disputes.resolve وحدها.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async open(
    customerUserId: string,
    subOrderId: string,
    input: { reasonCode: string; message: string },
  ): Promise<{ id: string }> {
    const sub = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, order: { customerUserId } },
      select: { status: true, disputes: { where: { status: { in: OPEN } }, select: { id: true } } },
    });
    if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    if (!(DISPUTABLE as readonly string[]).includes(sub.status)) {
      throw new ConflictError('النزاع متاح بعد الشحن وقبل إكمال الطلب.', { status: sub.status });
    }
    if (sub.disputes.length > 0) throw new ConflictError('لهذا الطلب نزاع قائم.', { disputeId: sub.disputes[0]!.id });

    return this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.create({
        data: { subOrderId, openedByUserId: customerUserId, against: 'vendor', reasonCode: input.reasonCode },
        select: { id: true },
      });
      await tx.disputeMessage.create({
        data: { disputeId: d.id, senderUserId: customerUserId, senderRole: 'customer', body: input.message.trim(), attachments: [] },
      });
      await tx.auditLog.create({
        data: { actorUserId: customerUserId, actorRole: 'customer', action: 'dispute.open', entityType: 'Dispute', entityId: d.id, afterJson: { subOrderId, reasonCode: input.reasonCode } },
      });
      return d;
    });
  }

  async list(party: Party, status?: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { ...this.scope(party), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        reasonCode: true,
        status: true,
        createdAt: true,
        subOrder: { select: { id: true, subOrderNumber: true, vendor: { select: { nameAr: true } }, order: { select: { orderNumber: true } } } },
        _count: { select: { messages: true } },
      },
    });
    return rows;
  }

  async get(party: Party, id: string) {
    const d = await this.prisma.dispute.findFirst({
      where: { id, ...this.scope(party) },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, select: { id: true, senderRole: true, body: true, createdAt: true } },
        subOrder: {
          select: {
            id: true,
            subOrderNumber: true,
            status: true,
            vendor: { select: { nameAr: true } },
            order: { select: { orderNumber: true } },
          },
        },
      },
    });
    if (!d) throw new NotFoundError('النزاع غير موجود.', { id });
    return d;
  }

  async message(party: Party, id: string, body: string): Promise<void> {
    const d = await this.get(party, id);
    if (!OPEN.includes(d.status)) throw new ConflictError('النزاع مغلق.');
    await this.prisma.disputeMessage.create({
      data: { disputeId: id, senderUserId: party.userId, senderRole: ROLE[party.kind], body: body.trim(), attachments: [] },
    });
    // الطرف الآخر يُبلَّغ: رسالة لا يراها صاحبها لا تحلّ نزاعاً
    const s = await this.prisma.subOrder.findUniqueOrThrow({
      where: { id: d.subOrder.id },
      select: { vendorId: true, order: { select: { customerUserId: true, customer: { select: { fullName: true } } } } },
    });
    if (party.kind !== 'customer') {
      await this.notifications.enqueue({
        code: 'dispute_message',
        userId: s.order.customerUserId,
        vars: {
          name: (s.order.customer?.fullName ?? '').trim().split(/\s+/)[0] || 'عميلنا',
          order_number: d.subOrder.subOrderNumber,
          link: `/account/disputes/${id}`,
        },
      });
    }
    if (party.kind !== 'vendor') {
      const v = await this.prisma.vendor.findUniqueOrThrow({ where: { id: s.vendorId }, select: { ownerUserId: true, nameAr: true } });
      await this.notifications.enqueue({
        code: 'dispute_message',
        userId: v.ownerUserId,
        vars: { name: v.nameAr, order_number: d.subOrder.subOrderNumber, link: `/vendor/disputes/${id}` },
      });
    }
  }

  /** تصعيد للإدارة — من المشتري أو البائع حين لا يتّفقان */
  async escalate(party: Party, id: string): Promise<void> {
    await this.get(party, id);
    const { count } = await this.prisma.dispute.updateMany({ where: { id, status: 'open' }, data: { status: 'escalated' } });
    if (count === 0) throw new ConflictError('لا يُصعَّد إلا نزاع مفتوح.');
    await this.prisma.auditLog.create({
      data: { actorUserId: party.userId, actorRole: ROLE[party.kind], action: 'dispute.escalate', entityType: 'Dispute', entityId: id },
    });
  }

  /** انسحاب المشتري: يغلق النزاع ويفكّ تجميد الإكمال */
  async withdraw(customerUserId: string, id: string): Promise<void> {
    await this.get({ kind: 'customer', userId: customerUserId }, id);
    const { count } = await this.prisma.dispute.updateMany({
      where: { id, status: { in: OPEN } },
      data: { status: 'withdrawn', closedAt: new Date() },
    });
    if (count === 0) throw new ConflictError('النزاع مغلق.');
  }

  async resolve(adminUserId: string, id: string, input: { outcome: 'customer' | 'vendor'; resolution: string }): Promise<void> {
    const { count } = await this.prisma.dispute.updateMany({
      where: { id, status: { in: OPEN } },
      data: {
        status: input.outcome === 'customer' ? 'resolved_customer' : 'resolved_vendor',
        resolution: input.resolution.trim(),
        resolvedBy: adminUserId,
        closedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictError('النزاع مغلق أو غير موجود.');
    await this.prisma.auditLog.create({
      data: { actorUserId: adminUserId, actorRole: 'admin', action: 'dispute.resolve', entityType: 'Dispute', entityId: id, afterJson: input },
    });
  }

  private scope(party: Party) {
    if (party.kind === 'customer') return { subOrder: { order: { customerUserId: party.userId } } };
    if (party.kind === 'vendor') return { subOrder: { vendorId: party.vendorId } };
    return {};
  }
}
