import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { like, pageArgs } from '../../../common/paging';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor, VendorScope } from '../../../common/security/actor';
import { NotificationsService } from '../../notifications/public';
import {
  BODY_MAX,
  BODY_MIN,
  isUnreadFor,
  orderKey,
  previewOf,
  productKey,
  shouldNotify,
  type Side,
  type ThreadState,
} from '../domain/messages';

const NOT_FOUND = 'المحادثة غير موجودة. حدّث الصفحة لترى رسائلك الحالية.';
const PRODUCT_NOT_FOUND = 'المنتج غير متاح الآن، فلا يمكن سؤال متجره عنه.';
const ORDER_NOT_FOUND = 'الطلب غير موجود في حسابك.';

/**
 * محادثات الصفحة الواحدة من صندوق شخص أو متجر — «المزيد» يُلحق ما بعدها. كان سقفاً بمئتين:
 * الأقدم يبقى محفوظاً ولا يُعرض، والبحث يصفّي ما جُلب وحده (3 نوفمبر 2026).
 */
export const THREADS_PAGE = 30;

export interface ThreadQuery {
  search?: string;
  page: number;
}

export interface ThreadList {
  unread: number;
  items: ThreadRow[];
  /** نتيجة البحث كلها — «X من Y» */
  total: number;
  /** محادثات الصندوق كلها بلا بحث — رأس الصفحة */
  all: number;
}

/** البحث في الصندوق: سياق المحادثة (المنتج أو رقم الطلب) أو آخر رسالة، واسم الطرف الآخر */
function threadSearch(t: string, side: Side): Prisma.ConversationWhereInput {
  const general = ['استفسار عام', 'general inquiry'].some((l) => l.includes(t.toLowerCase()));
  return {
    OR: [
      { lastPreview: like(t) },
      { product: { nameAr: like(t) } },
      { subOrder: { subOrderNumber: like(t) } },
      side === 'vendor' ? { customer: { fullName: like(t) } } : { vendor: { nameAr: like(t) } },
      ...(general ? [{ productId: null, subOrderId: null }] : []),
    ],
  };
}

export interface ContextView {
  kind: 'product' | 'order' | 'general';
  label: string;
  productSlug?: string;
  /** رقم الطلب الأب — صفحة الطلب في حساب المشتري تُفتح به */
  orderNumber?: string;
  /** رقم شحنة المتجر من الطلب (الطلب الفرعي) */
  subOrderNumber?: string;
  /** معرّف الطلب الفرعي — صفحة الطلب في لوحة البائع تُفتح به (للبائع وحده) */
  subOrderId?: string;
}

export interface ThreadRow {
  id: string;
  shop: { nameAr: string; slug: string };
  customer?: { fullName: string };
  context: ContextView;
  lastPreview: string;
  lastMessageAt: Date;
  lastSenderSide: Side;
  unread: boolean;
}

export interface MessageView {
  id: string;
  side: Side;
  mine: boolean;
  body: string;
  createdAt: Date;
}

export interface ThreadView extends Omit<ThreadRow, 'unread' | 'lastPreview' | 'lastMessageAt' | 'lastSenderSide'> {
  messages: MessageView[];
}

const ROW_SELECT = {
  id: true,
  lastPreview: true,
  lastMessageAt: true,
  lastSenderSide: true,
  customerReadAt: true,
  vendorReadAt: true,
  vendor: { select: { nameAr: true, slug: true } },
  customer: { select: { fullName: true } },
  product: { select: { nameAr: true, slug: true } },
  subOrder: { select: { id: true, subOrderNumber: true, order: { select: { orderNumber: true } } } },
} as const satisfies Prisma.ConversationSelect;

type Row = Prisma.ConversationGetPayload<{ select: typeof ROW_SELECT }>;

function contextOf(r: Pick<Row, 'product' | 'subOrder'>, side: Side): ContextView {
  if (r.product) return { kind: 'product', label: `منتج: ${r.product.nameAr}`, productSlug: r.product.slug };
  if (r.subOrder) {
    return {
      kind: 'order',
      label: `طلب ${r.subOrder.subOrderNumber}`,
      subOrderNumber: r.subOrder.subOrderNumber,
      // كلٌّ يرى المعرّف الذي تفتح به صفحته — ولا يرى البائع رقم طلب المشتري الأب
      ...(side === 'customer' ? { orderNumber: r.subOrder.order.orderNumber } : { subOrderId: r.subOrder.id }),
    };
  }
  return { kind: 'general', label: 'استفسار عام' };
}

function rowOf(r: Row, side: Side): ThreadRow {
  return {
    id: r.id,
    shop: { nameAr: r.vendor.nameAr, slug: r.vendor.slug },
    ...(side === 'vendor' ? { customer: { fullName: r.customer.fullName } } : {}),
    context: contextOf(r, side),
    lastPreview: r.lastPreview,
    lastMessageAt: r.lastMessageAt,
    lastSenderSide: r.lastSenderSide as Side,
    unread: isUnreadFor(r, side),
  };
}

/** يشذّب النصّ ويفرض حدوده — الـ DTO يفحص قبله، وهذا خط الدفاع لكل مستدعٍ آخر */
export function cleanBody(body: unknown): string {
  const text = typeof body === 'string' ? body.trim() : '';
  if (text.length < BODY_MIN) throw new InvalidInputError('اكتب رسالة قبل الإرسال.');
  if (text.length > BODY_MAX) throw new InvalidInputError(`الرسالة أطول من ${BODY_MAX} حرف. اختصرها أو قسّمها رسالتين.`);
  return text;
}

type Tx = Prisma.TransactionClient;

interface Target {
  vendorId: string;
  vendorOwnerId: string;
  contextKey: string;
  productId: string | null;
  subOrderId: string | null;
  context: string;
}

/**
 * الرسائل بين المشتري والمتجر — ST-09 و ST-28 و VD-15.
 *
 * **عزل الطرفين بنيوي:** كل قراءة وكتابة تحمل مالكها في شرطها — `customerId`
 * الفاعل في مسارات المشتري، و`vendorId` النطاق في مسارات البائع. محادثة
 * غيرك تُرجع 404 كالمعرّف غير الموجود (ADR-010).
 *
 * **المشتري وحده يبدأ.** البائع يردّ على محادثة قائمة ولا يفتح واحدة: لا
 * رسائل تسويقية غير مطلوبة من متجر إلى من اشترى منه.
 *
 * **كل رسالة معاملة واحدة:** إدراج الرسالة، وتحديث رأس المحادثة، والتنبيه —
 * يُلتزم الثلاثة معاً أو لا شيء. وصف المحادثة مقفول `FOR UPDATE` أثناءها،
 * فرسالتان متزامنتان على الخيط نفسه تتتاليان ويرى الثانية حالة الأولى، فلا
 * يُرسل تنبيهان لدفعة واحدة.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- المشتري

  /** سؤال جديد أو تكملة محادثة السياق نفسه — يعيد معرّف المحادثة */
  async start(
    actor: Actor,
    input: { productId?: string | undefined; orderNumber?: string | undefined; body: string },
  ): Promise<{ id: string }> {
    const body = cleanBody(input.body);
    const hasProduct = input.productId !== undefined;
    const hasOrder = input.orderNumber !== undefined;
    if (hasProduct === hasOrder) {
      throw new InvalidInputError('حدّد سياقاً واحداً للرسالة: منتجاً أو طلباً.');
    }
    const target = hasProduct
      ? await this.productTarget(input.productId!)
      : await this.orderTarget(actor.userId, input.orderNumber!);

    if (actor.vendorId === target.vendorId || actor.userId === target.vendorOwnerId) {
      throw new InvalidInputError('هذا متجرك — لا تُراسل متجرك من حساب المشتري.');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.conversation.createMany({
        data: [
          {
            customerId: actor.userId,
            vendorId: target.vendorId,
            contextKey: target.contextKey,
            productId: target.productId,
            subOrderId: target.subOrderId,
            lastMessageAt: now,
            lastPreview: previewOf(body),
            lastSenderSide: 'customer',
            customerReadAt: now,
            createdAt: now,
          },
        ],
        skipDuplicates: true,
      });
      const isNew = created.count === 1;
      const [locked] = await tx.$queryRaw<(ThreadState & { id: string })[]>`
        SELECT "id", "lastSenderSide", "lastMessageAt", "customerReadAt", "vendorReadAt"
          FROM "conversations"
         WHERE "customerId" = ${actor.userId}::uuid
           AND "vendorId" = ${target.vendorId}::uuid
           AND "contextKey" = ${target.contextKey}
           FOR UPDATE`;
      if (!locked) throw new NotFoundError(NOT_FOUND);
      await this.append(tx, {
        conversationId: locked.id,
        senderUserId: actor.userId,
        side: 'customer',
        body,
        prev: isNew ? null : locked,
        now,
        notify: { vendorId: target.vendorId, customerId: actor.userId, context: target.context },
      });
      return { id: locked.id };
    });
  }

  async listForCustomer(userId: string, q: ThreadQuery = { page: 1 }): Promise<ThreadList> {
    return this.list({ customerId: userId }, 'customer', q);
  }

  async openForCustomer(userId: string, id: string): Promise<ThreadView> {
    return this.open({ id, customerId: userId }, 'customer');
  }

  async replyAsCustomer(userId: string, id: string, rawBody: string): Promise<MessageView> {
    return this.reply({ id, customerId: userId }, userId, 'customer', rawBody);
  }

  // ----------------------------------------------------------------- البائع

  async listForVendor(scope: VendorScope, q: ThreadQuery = { page: 1 }): Promise<ThreadList> {
    return this.list({ vendorId: scope.vendorId }, 'vendor', q);
  }

  /** الصندوق صفحةً صفحة بالأحدث رسالةً — غير المقروء للصندوق كله، والإجمالي لنتيجة البحث */
  private async list(owner: { customerId: string } | { vendorId: string }, side: Side, q: ThreadQuery): Promise<ThreadList> {
    const where: Prisma.ConversationWhereInput = { ...owner, ...(q.search ? threadSearch(q.search, side) : {}) };
    const [rows, total, unread, all] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(q.page, THREADS_PAGE),
        select: ROW_SELECT,
      }),
      this.prisma.conversation.count({ where }),
      this.countUnread(owner),
      q.search ? this.prisma.conversation.count({ where: owner }) : null,
    ]);
    return { unread, items: rows.map((r) => rowOf(r, side)), total, all: all ?? total };
  }

  async openForVendor(scope: VendorScope, id: string): Promise<ThreadView> {
    return this.open({ id, vendorId: scope.vendorId }, 'vendor');
  }

  async replyAsVendor(scope: VendorScope, userId: string, id: string, rawBody: string): Promise<MessageView> {
    return this.reply({ id, vendorId: scope.vendorId }, userId, 'vendor', rawBody);
  }

  // ------------------------------------------------------------------ داخلي

  private async productTarget(productId: string): Promise<Target> {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, status: 'active', deletedAt: null, vendor: { status: 'approved' } },
      select: { id: true, nameAr: true, vendor: { select: { id: true, ownerUserId: true } } },
    });
    if (!p) throw new NotFoundError(PRODUCT_NOT_FOUND);
    return {
      vendorId: p.vendor.id,
      vendorOwnerId: p.vendor.ownerUserId,
      contextKey: productKey(p.id),
      productId: p.id,
      subOrderId: null,
      context: `منتج: ${p.nameAr}`,
    };
  }

  /** الطلب الفرعي يُقرأ في نطاق المشتري: رقم شحنة غيره كرقم غير موجود */
  private async orderTarget(userId: string, subOrderNumber: string): Promise<Target> {
    const s = await this.prisma.subOrder.findFirst({
      where: { subOrderNumber, order: { customerUserId: userId } },
      select: { id: true, subOrderNumber: true, vendor: { select: { id: true, ownerUserId: true } } },
    });
    if (!s) throw new NotFoundError(ORDER_NOT_FOUND);
    return {
      vendorId: s.vendor.id,
      vendorOwnerId: s.vendor.ownerUserId,
      contextKey: orderKey(s.id),
      productId: null,
      subOrderId: s.id,
      context: `طلب ${s.subOrderNumber}`,
    };
  }

  /**
   * عدّ المحادثات غير المقروءة — مقارنة عمودين في الصف نفسه، فلا تصلح لها
   * شروط Prisma العادية. الطرف مُثبَّت في الاستعلام لا ممرَّر نصاً.
   */
  private async countUnread(owner: { customerId: string } | { vendorId: string }): Promise<number> {
    const rows =
      'customerId' in owner
        ? await this.prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "conversations"
             WHERE "customerId" = ${owner.customerId}::uuid AND "lastSenderSide" = 'vendor'
               AND ("customerReadAt" IS NULL OR "customerReadAt" < "lastMessageAt")`
        : await this.prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "conversations"
             WHERE "vendorId" = ${owner.vendorId}::uuid AND "lastSenderSide" = 'customer'
               AND ("vendorReadAt" IS NULL OR "vendorReadAt" < "lastMessageAt")`;
    return rows[0]?.n ?? 0;
  }

  /** يفتح المحادثة ويعلّمها مقروءة لمن فتحها — `where` يحمل المالك دائماً */
  private async open(
    where: { id: string; customerId: string } | { id: string; vendorId: string },
    side: Side,
  ): Promise<ThreadView> {
    const r = await this.prisma.conversation.findFirst({
      where,
      select: {
        ...ROW_SELECT,
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, senderSide: true, body: true, createdAt: true },
        },
      },
    });
    if (!r) throw new NotFoundError(NOT_FOUND);
    /*
     * الشرط نفسه في التحديث: لا يعلَّم مقروءاً إلا ما يملكه الفاتح. وشرط
     * `lastMessageAt` يمنع تعليم رسالة وصلت بين القراءة والتعليم — لم يرها
     * أحد بعد، فتبقى غير مقروءة حتى الفتح التالي.
     */
    const now = new Date();
    await this.prisma.conversation.updateMany({
      where: { ...where, lastMessageAt: r.lastMessageAt },
      data: side === 'customer' ? { customerReadAt: now } : { vendorReadAt: now },
    });
    const row = rowOf(r, side);
    return {
      id: row.id,
      shop: row.shop,
      ...(row.customer ? { customer: row.customer } : {}),
      context: row.context,
      messages: r.messages.map((m) => ({
        id: m.id,
        side: m.senderSide as Side,
        mine: m.senderSide === side,
        body: m.body,
        createdAt: m.createdAt,
      })),
    };
  }

  private async reply(
    where: { id: string; customerId: string } | { id: string; vendorId: string },
    senderUserId: string,
    side: Side,
    rawBody: string,
  ): Promise<MessageView> {
    const body = cleanBody(rawBody);
    return this.prisma.$transaction(async (tx) => {
      // القفل والملكية في استعلام واحد: صفّ غيرك لا يُقفل ولا يُقرأ
      type Locked = ThreadState & { id: string; vendorId: string; customerId: string };
      const [prev] =
        'customerId' in where
          ? await tx.$queryRaw<Locked[]>`
              SELECT "id", "vendorId", "customerId", "lastSenderSide", "lastMessageAt", "customerReadAt", "vendorReadAt"
                FROM "conversations"
               WHERE "id" = ${where.id}::uuid AND "customerId" = ${where.customerId}::uuid
                 FOR UPDATE`
          : await tx.$queryRaw<Locked[]>`
              SELECT "id", "vendorId", "customerId", "lastSenderSide", "lastMessageAt", "customerReadAt", "vendorReadAt"
                FROM "conversations"
               WHERE "id" = ${where.id}::uuid AND "vendorId" = ${where.vendorId}::uuid
                 FOR UPDATE`;
      if (!prev) throw new NotFoundError(NOT_FOUND);
      const context = await this.contextText(tx, where.id);
      const now = new Date();
      return this.append(tx, {
        conversationId: prev.id,
        senderUserId,
        side,
        body,
        prev,
        now,
        notify: { vendorId: prev.vendorId, customerId: prev.customerId, context },
      });
    });
  }

  private async contextText(tx: Tx, id: string): Promise<string> {
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id },
      select: { product: { select: { nameAr: true } }, subOrder: { select: { subOrderNumber: true } } },
    });
    if (c.product) return `منتج: ${c.product.nameAr}`;
    if (c.subOrder) return `طلب ${c.subOrder.subOrderNumber}`;
    return 'استفسار عام';
  }

  /**
   * الرسالة ورأس المحادثة والتنبيه — داخل معاملة المستدعي وبعد قفله الصف.
   * المرسِل رأى الخيط كله لحظة كتب، فتُحدَّث قراءته هو أيضاً.
   */
  private async append(
    tx: Tx,
    m: {
      conversationId: string;
      senderUserId: string;
      side: Side;
      body: string;
      prev: ThreadState | null;
      now: Date;
      notify: { vendorId: string; customerId: string; context: string };
    },
  ): Promise<MessageView> {
    const msg = await tx.conversationMessage.create({
      data: {
        conversationId: m.conversationId,
        senderUserId: m.senderUserId,
        senderSide: m.side,
        body: m.body,
        createdAt: m.now,
      },
      select: { id: true, createdAt: true },
    });
    await tx.conversation.update({
      where: { id: m.conversationId },
      data: {
        lastMessageAt: m.now,
        lastPreview: previewOf(m.body),
        lastSenderSide: m.side,
        ...(m.side === 'customer' ? { customerReadAt: m.now } : { vendorReadAt: m.now }),
      },
    });

    if (shouldNotify(m.prev, m.side)) {
      const preview = previewOf(m.body);
      if (m.side === 'customer') {
        const customer = await tx.user.findUniqueOrThrow({ where: { id: m.notify.customerId }, select: { fullName: true } });
        await this.notifications.enqueueVendor(
          {
            code: 'message_to_vendor',
            vendorId: m.notify.vendorId,
            vars: {
              customer_name: customer.fullName,
              context: m.notify.context,
              preview,
              link: `/vendor/messages?c=${m.conversationId}`,
            },
          },
          tx,
        );
      } else {
        const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: m.notify.vendorId }, select: { nameAr: true } });
        await this.notifications.enqueue(
          {
            code: 'message_to_customer',
            userId: m.notify.customerId,
            vars: {
              store_name: vendor.nameAr,
              context: m.notify.context,
              preview,
              link: `/account/messages?c=${m.conversationId}`,
            },
          },
          tx,
        );
      }
    }

    return { id: msg.id, side: m.side, mine: true, body: m.body, createdAt: msg.createdAt };
  }
}
