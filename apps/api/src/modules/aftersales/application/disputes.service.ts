import { Injectable } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { dirOf, folded, like, pageArgs, type SortOrder } from '../../../common/paging';
import { NotificationsService, storeNameVars } from '../../notifications/public';
import { OrderLifecycleService } from '../../orders/public';

/** حالات يُفتح فيها نزاع: بعد الشحن وحتى قبل الإكمال */
const DISPUTABLE = ['shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned'] as const;
const OPEN = ['open', 'escalated'];

/**
 * «مُسترَد»: نزاع «لم يصلني الاسترداد» وحده، خلال 14 يوماً من الاسترداد — والمال خرج من المنصّة
 * لا من البائع، فيصل الإدارة مصعَّداً من لحظته (قرار صاحبة المشروع، BUY-052، 28 أكتوبر 2026).
 * كان «مُسترَد» مغلقاً: من لم يصله ماله لا يجد إلا «راسل المتجر»، والمتجر لا يملك الاسترداد.
 */
export const REFUND_DISPUTE_DAYS = 14;
const DAY = 86_400_000;

export type Party =
  | { kind: 'customer'; userId: string }
  | { kind: 'vendor'; userId: string; vendorId: string }
  | { kind: 'admin'; userId: string };

const ROLE: Record<Party['kind'], Role> = { customer: 'customer', vendor: 'vendor_owner', admin: 'admin' };

type Db = Prisma.TransactionClient | PrismaService;

/** صفّ النزاع في القوائم — للأطراف الثلاثة */
const LIST_SELECT = {
  id: true,
  reasonCode: true,
  status: true,
  createdAt: true,
  subOrder: { select: { id: true, subOrderNumber: true, vendor: { select: { nameAr: true } }, order: { select: { orderNumber: true } } } },
  _count: { select: { messages: true } },
} satisfies Prisma.DisputeSelect;

/** سبب النزاع كما اختاره المشتري — للإشعار؛ الرمز نفسه إن جدّ سبب لم يُترجم */
export const REASON_AR: Readonly<Record<string, string>> = {
  not_received: 'لم يصلني الطلب',
  damaged: 'وصل تالفاً',
  not_as_described: 'لا يطابق الوصف',
  return_refused: 'رُفض إرجاعي',
  refund_missing: 'لم يصلني الاسترداد',
  other: 'مشكلة أخرى',
};

/** السبب كما يقرؤه من اختار الإنجليزية — يُبحث به كما يُبحث بالعربي (نسخة الواجهة DISPUTE_REASONS_EN) */
const REASON_EN: Readonly<Record<string, string>> = {
  not_received: "I didn't receive my order",
  damaged: 'Arrived damaged',
  not_as_described: 'Not as described',
  return_refused: 'My return was refused',
  refund_missing: "I didn't receive my refund",
  other: 'Another problem',
};

/** نزاعات الصفحة الواحدة في قائمة المشتري أو المتجر */
export const DISPUTES_PAGE = 20;

/** القرار كما يقرؤه كل طرف — لمن حُسم، وما يعنيه لماله */
export const OUTCOME_AR = {
  customer: { customer: 'حُسم لصالحك، ويُردّ لك ما بقي من مبلغ هذا المتجر إلى وسيلة دفعك', vendor: 'حُسم لصالح المتجر' },
  vendor: { customer: 'حُسم لصالح المشتري، ورُدّ له ما بقي من مبلغ الطلب', vendor: 'حُسم لصالحكم، ويُحرَّر مال الطلب بموعده' },
} as const;

/**
 * دُفع بتحويل بنكي: لا ردّ آلي إلى «وسيلة الدفع» — الردّ ينتظر أن تحوّله الإدارة
 * يدوياً، ثم يصل المشتري مرجعه (refund_transferred). الوعد بغير ذلك يتركه ينتظر
 * مالاً لم يخرج بعد (ADM-071، 24 أكتوبر 2026).
 */
export const OUTCOME_CUSTOMER_TRANSFER_AR = 'حُسم لصالحك، وستحوّل لك الإدارة ما بقي من مبلغ هذا المتجر، ونرسل لك مرجع التحويل حين يتمّ';

/** الاسم الأول للتحية — `\s` لا `s`: «Thomas» كان يُقصّ عند أول حرف s */
const firstName = (full: string | null | undefined): string => (full ?? '').trim().split(/\s+/)[0] || 'عميلنا';

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
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  async open(
    customerUserId: string,
    subOrderId: string,
    input: { reasonCode: string; message: string },
  ): Promise<{ id: string }> {
    const sub = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, order: { customerUserId } },
      select: {
        status: true,
        vendorId: true,
        subOrderNumber: true,
        vendor: { select: { nameAr: true, nameEn: true } },
        disputes: { where: { status: { in: OPEN } }, select: { id: true } },
        statusHistory: { where: { toStatus: 'refunded' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    });
    if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    const refundCase = sub.status === 'refunded';
    if (refundCase) {
      if (input.reasonCode !== 'refund_missing') {
        throw new ConflictError('على طلب مُسترَد يُفتح النزاع لسبب «لم يصلني الاسترداد» وحده.', { status: sub.status });
      }
      const refundedAt = sub.statusHistory[0]?.createdAt;
      if (!refundedAt || Date.now() - refundedAt.getTime() > REFUND_DISPUTE_DAYS * DAY) {
        throw new ConflictError(`انقضت ${REFUND_DISPUTE_DAYS} يوماً على الاسترداد — لا يُفتح عليه نزاع.`, { status: sub.status });
      }
    } else if (!(DISPUTABLE as readonly string[]).includes(sub.status)) {
      throw new ConflictError('النزاع متاح بعد الشحن وقبل إكمال الطلب.', { status: sub.status });
    }
    if (sub.disputes.length > 0) throw new ConflictError('لهذا الطلب نزاع قائم.', { disputeId: sub.disputes[0]!.id });

    return this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.create({
        data: { subOrderId, openedByUserId: customerUserId, against: 'vendor', reasonCode: input.reasonCode, ...(refundCase ? { status: 'escalated' } : {}) },
        select: { id: true },
      });
      await tx.disputeMessage.create({
        data: { disputeId: d.id, senderUserId: customerUserId, senderRole: 'customer', body: input.message.trim(), attachments: [] },
      });
      await tx.auditLog.create({
        data: { actorUserId: customerUserId, actorRole: 'customer', action: 'dispute.open', entityType: 'Dispute', entityId: d.id, afterJson: { subOrderId, reasonCode: input.reasonCode, ...(refundCase ? { escalated: true } : {}) } },
      });
      // الاسترداد شأن المنصّة: الإدارة تعرف الآن لا حين يتذكّر أحدٌ «صعّد»
      if (refundCase) {
        await this.notifications.enqueueAdmins(
          {
            code: 'admin_dispute_escalated',
            permission: 'disputes.resolve',
            vars: {
              ...storeNameVars(sub.vendor),
              order_number: sub.subOrderNumber,
              reason: REASON_AR[input.reasonCode] ?? input.reasonCode,
              link: '/admin/disputes',
            },
          },
          tx,
        );
      }
      // مال طلبه جُمّد للتوّ: كان لا يعرف بالنزاع إلا إن فتح صفحته (J-06)
      await this.notifications.enqueueVendor(
        {
          code: 'vendor_dispute_opened',
          vendorId: sub.vendorId,
          vars: {
            order_number: sub.subOrderNumber,
            reason: REASON_AR[input.reasonCode] ?? input.reasonCode,
            link: `/vendor/disputes/${d.id}`,
          },
        },
        tx,
      );
      return d;
    });
  }

  /**
   * نزاعات المشتري أو المتجر، الأحدث أولاً وعشرين عشرين. كانت أول مئة بلا ما بعدها، وبحث البائع
   * يصفّي ما جُلب وحده (3 نوفمبر 2026). البحث برقم الطلب أو طلب المتجر، أو بالسبب كما يُقرأ
   * على الشاشة بالعربية أو الإنجليزية.
   */
  async list(party: Party, q: { status?: string; search?: string; page: number }) {
    const t = q.search;
    const reasons = t
      ? Object.keys(REASON_AR).filter((k) => [REASON_AR[k], REASON_EN[k]].some((label) => label?.toLowerCase().includes(t.toLowerCase())))
      : [];
    const where: Prisma.DisputeWhereInput = {
      ...this.scope(party),
      ...(q.status ? { status: q.status } : {}),
      ...(t
        ? {
            OR: [
              { subOrder: { subOrderNumber: like(t) } },
              { subOrder: { order: { orderNumber: like(t) } } },
              ...(reasons.length ? [{ reasonCode: { in: reasons } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageArgs(q.page, DISPUTES_PAGE), select: LIST_SELECT }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * AD-14 للإدارة — بالحالة والبحث وخمسين خمسين. البحث برقم الطلب أو طلب المتجر، أو اسم
   * المتجر، أو اسم المشتري أو بريده: من يتصل بالدعم يذكر واحداً منها.
   */
  async adminList(q: { status: string; search?: string; page: number; sort?: SortOrder }) {
    const t = q.search;
    const where: Prisma.DisputeWhereInput = {
      status: q.status,
      ...(t
        ? {
            subOrder: {
              OR: [
                { subOrderNumber: like(t) },
                { vendor: { nameArFold: folded(t) } },
                { order: { OR: [{ orderNumber: like(t) }, { customer: { OR: [{ email: like(t) }, { fullNameFold: folded(t) }] } }] } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({ where, orderBy: [{ createdAt: dirOf(q.sort, 'newest') }, { id: 'asc' }], ...pageArgs(q.page), select: LIST_SELECT }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total };
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
            vendor: { select: { nameAr: true, nameEn: true } },
            order: { select: { orderNumber: true } },
          },
        },
      },
    });
    if (!d) throw new NotFoundError('النزاع غير موجود.', { id });
    return d;
  }

  async message(party: Party, id: string, body: string): Promise<void> {
    // تُقاس بعد إزالة المسافات: رسالة من مسافات كانت تُحفظ فارغة في مجرى الطرفين (ADM-073، 31 أكتوبر 2026)
    const text = body.trim();
    if (!text) throw new InvalidInputError('الرسالة فارغة — اكتب ما يقرؤه الطرف الآخر.');
    const d = await this.get(party, id);
    if (!OPEN.includes(d.status)) throw new ConflictError('النزاع مغلق.');
    await this.prisma.disputeMessage.create({
      data: { disputeId: id, senderUserId: party.userId, senderRole: ROLE[party.kind], body: text, attachments: [] },
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
          name: firstName(s.order.customer?.fullName),
          order_number: d.subOrder.subOrderNumber,
          link: `/account/disputes/${id}`,
        },
      });
    }
    if (party.kind !== 'vendor') {
      const v = await this.prisma.vendor.findUniqueOrThrow({ where: { id: s.vendorId }, select: { ownerUserId: true, nameAr: true, nameEn: true } });
      await this.notifications.enqueue({
        code: 'dispute_message',
        userId: v.ownerUserId,
        vars: { ...storeNameVars(v, 'name'), order_number: d.subOrder.subOrderNumber, link: `/vendor/disputes/${id}` },
      });
    }
    // بعد التصعيد صار الحسم للإدارة: ما يضيفه طرف يقرؤه من يحسم قبل قراره
    if (d.status === 'escalated' && party.kind !== 'admin') {
      await this.notifications.enqueueAdmins({
        code: 'admin_dispute_message',
        permission: 'disputes.resolve',
        vars: { order_number: d.subOrder.subOrderNumber, sender: party.kind === 'customer' ? 'المشتري' : 'المتجر', link: '/admin/disputes' },
      });
    }
  }

  /** تصعيد للإدارة — من المشتري أو البائع حين لا يتّفقان */
  async escalate(party: Party, id: string): Promise<void> {
    await this.get(party, id);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.dispute.updateMany({ where: { id, status: 'open' }, data: { status: 'escalated' } });
      if (count === 0) throw new ConflictError('لا يُصعَّد إلا نزاع مفتوح.');
      await tx.auditLog.create({
        data: { actorUserId: party.userId, actorRole: ROLE[party.kind], action: 'dispute.escalate', entityType: 'Dispute', entityId: id },
      });
      // من صعّده يعرف؛ الآخر يُبلَّغ أن القرار صار للإدارة
      await this.notifyParties(tx, id, {
        customer: party.kind === 'customer' ? null : { code: 'dispute_escalated', vars: {} },
        vendor: party.kind === 'vendor' ? null : { code: 'vendor_dispute_escalated', vars: {} },
      });
      // ومن يحسم من المديرين: النزاع المصعَّد يجمّد مال المتجر حتى يتحرّك أحدهم
      const d = await tx.dispute.findUniqueOrThrow({
        where: { id },
        select: { reasonCode: true, subOrder: { select: { subOrderNumber: true, vendor: { select: { nameAr: true, nameEn: true } } } } },
      });
      await this.notifications.enqueueAdmins(
        {
          code: 'admin_dispute_escalated',
          permission: 'disputes.resolve',
          vars: {
            ...storeNameVars(d.subOrder.vendor),
            order_number: d.subOrder.subOrderNumber,
            reason: REASON_AR[d.reasonCode] ?? d.reasonCode,
            link: '/admin/disputes',
          },
        },
        tx,
      );
    });
  }

  /**
   * انسحاب المشتري: يغلق النزاع ويفكّ تجميد الإكمال. كان صامتاً: يبقى المتجر على «ماله مجمَّد»
   * والإدارة على «ينتظر حسمك» (BUY-059، 28 أكتوبر 2026) — الآن يُبلَّغ المتجر، والإدارة إن كان لديها.
   */
  async withdraw(customerUserId: string, id: string): Promise<void> {
    const d = await this.get({ kind: 'customer', userId: customerUserId }, id);
    if (!OPEN.includes(d.status)) throw new ConflictError('النزاع مغلق.');
    await this.prisma.$transaction(async (tx) => {
      // على الحالة المقروءة: تصعيد بينهما يُرفض، فلا يُبلَّغ بالسحب من لم يكن النزاع لديه
      const { count } = await tx.dispute.updateMany({
        where: { id, status: d.status },
        data: { status: 'withdrawn', closedAt: new Date() },
      });
      if (count === 0) throw new ConflictError('النزاع مغلق.');
      // من سحب يعرف؛ المتجر يُبلَّغ أن ماله فُكّ
      await this.notifyParties(tx, id, { customer: null, vendor: { code: 'vendor_dispute_withdrawn', vars: {} } });
      if (d.status === 'escalated') {
        await this.notifications.enqueueAdmins(
          {
            code: 'admin_dispute_withdrawn',
            permission: 'disputes.resolve',
            vars: { ...storeNameVars(d.subOrder.vendor), order_number: d.subOrder.subOrderNumber, link: '/admin/disputes' },
          },
          tx,
        );
      }
    });
  }

  /**
   * الحسم — بصلاحية disputes.resolve.
   *
   * لصالح البائع: يُغلق النزاع فيُفكّ تجميد ماله. لصالح المشتري: كان يُغلق
   * بالطريقة نفسها — فلا يُردّ للمشتري شيء، ويُحرَّر مال البائع كأنه ربح. الآن
   * الإغلاق والاسترداد معاملة واحدة في دورة حياة الطلب: فشل أحدهما يُبقي النزاع
   * مفتوحاً والمال مجمّداً.
   */
  async resolve(adminUserId: string, id: string, input: { outcome: 'customer' | 'vendor'; resolution: string }): Promise<void> {
    const resolution = input.resolution.trim();
    // يُقاس بعد إزالة المسافات: خمس مسافات كانت تحسم النزاع بسبب فارغ يراه الطرفان (ADM-073، 31 أكتوبر 2026)
    if (resolution.length < 5) throw new InvalidInputError('سبب القرار يظهر للطرفين — 5 أحرف على الأقل.');
    const close = (customerOutcome: string) => async (db: Db) => {
      const { count } = await db.dispute.updateMany({
        where: { id, status: { in: OPEN } },
        data: {
          status: input.outcome === 'customer' ? 'resolved_customer' : 'resolved_vendor',
          resolution,
          resolvedBy: adminUserId,
          closedAt: new Date(),
        },
      });
      if (count === 0) throw new ConflictError('النزاع مغلق أو غير موجود.');
      await db.auditLog.create({
        data: { actorUserId: adminUserId, actorRole: 'admin', action: 'dispute.resolve', entityType: 'Dispute', entityId: id, afterJson: { ...input, resolution } },
      });
      // كان القرار لا يصل أحداً: يراه من يفتح الصفحة وحده (J-06 — ADM-069، BUY-061)
      await this.notifyParties(db, id, {
        customer: { code: 'dispute_resolved', vars: { outcome: customerOutcome, resolution } },
        vendor: { code: 'vendor_dispute_resolved', vars: { outcome: OUTCOME_AR.vendor[input.outcome], resolution } },
      });
    };

    if (input.outcome === 'vendor') return this.prisma.$transaction((tx) => close(OUTCOME_AR.customer.vendor)(tx));

    const d = await this.prisma.dispute.findUnique({
      where: { id },
      select: { subOrderId: true, subOrder: { select: { order: { select: { payment: { select: { method: true } } } } } } },
    });
    if (!d) throw new ConflictError('النزاع مغلق أو غير موجود.');
    const byTransfer = d.subOrder.order.payment?.method === 'bank_transfer';
    await this.lifecycle.refundForDispute(
      d.subOrderId,
      adminUserId,
      `حسم النزاع لصالح المشتري: ${resolution}`,
      close(byTransfer ? OUTCOME_CUSTOMER_TRANSFER_AR : OUTCOME_AR.customer.customer),
    );
  }

  /** إشعار طرفي النزاع أو أحدهما — المشتري باسمه الأول، والبائع لمالك متجره */
  private async notifyParties(
    db: Db,
    id: string,
    to: {
      customer: { code: string; vars: Record<string, string> } | null;
      vendor: { code: string; vars: Record<string, string> } | null;
    },
  ): Promise<void> {
    const d = await db.dispute.findUniqueOrThrow({
      where: { id },
      select: {
        subOrder: {
          select: {
            subOrderNumber: true,
            vendorId: true,
            order: { select: { customerUserId: true, customer: { select: { fullName: true } } } },
          },
        },
      },
    });
    const s = d.subOrder;
    if (to.customer) {
      await this.notifications.enqueue(
        {
          code: to.customer.code,
          userId: s.order.customerUserId,
          vars: { name: firstName(s.order.customer?.fullName), order_number: s.subOrderNumber, link: `/account/disputes/${id}`, ...to.customer.vars },
        },
        db,
      );
    }
    if (to.vendor) {
      await this.notifications.enqueueVendor(
        { code: to.vendor.code, vendorId: s.vendorId, vars: { order_number: s.subOrderNumber, link: `/vendor/disputes/${id}`, ...to.vendor.vars } },
        db,
      );
    }
  }

  private scope(party: Party) {
    if (party.kind === 'customer') return { subOrder: { order: { customerUserId: party.userId } } };
    if (party.kind === 'vendor') return { subOrder: { vendorId: party.vendorId } };
    return {};
  }
}
