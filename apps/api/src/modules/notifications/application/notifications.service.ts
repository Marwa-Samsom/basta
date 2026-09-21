import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CHANNELS,
  CHANNEL_LABELS,
  DEFAULT_TEMPLATES,
  EVENTS,
  eventOf,
  render,
  usedVariables,
  type Channel,
} from '../domain/templates';
import { deliver } from '../infrastructure/channels';

type Db = Prisma.TransactionClient | PrismaService;

const EVERY_FIVE_SECONDS = 5_000;
const MAX_ATTEMPTS = 5;

/**
 * الإشعارات — صندوق صادر (outbox).
 *
 * `enqueue` يُستدعى **داخل معاملة الحدث** (الدفع، الانتقال، التحويل): الإشعار
 * يُلتزم مع الحدث أو لا يُلتزم معه. والإرسال بعدها في `dispatch` — فلا يتأخّر
 * طلب المشتري على بريد، ولا يضيع بريد بسقوط الخادم بين الاثنين.
 *
 * والإشعار **لا يُسقط الحدث أبداً**: قالب معطوب أو متغيّر ناقص يُختم failed
 * بسببه عند الإرسال، والطلب قائم.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Notifications');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDefaults();
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.timer = setInterval(() => void this.dispatch().catch((e) => this.logger.error(e)), EVERY_FIVE_SECONDS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** يُدرج القوالب الافتراضية الغائبة — ولا يكتب فوق تعديل الإدارة */
  async ensureDefaults(): Promise<number> {
    const r = await this.prisma.notificationTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({
        code: t.code,
        channel: t.channel,
        locale: 'ar',
        subject: t.subject,
        body: t.body,
        variablesJson: [...(eventOf(t.code)?.variables ?? [])],
        // مراجعة أولى عند الكتابة؛ الإقرار النهائي من AD-20 باسم المراجِع
        reviewedAt: new Date(),
        reviewedBy: 'المراجعة الأولى',
      })),
      skipDuplicates: true,
    });
    return r.count;
  }

  // ------------------------------------------------------------ الإدراج

  async enqueue(
    input: { code: string; userId: string | null | undefined; vars: Record<string, string> },
    db: Db = this.prisma,
  ): Promise<number> {
    if (!input.userId) return 0;
    const templates = await db.notificationTemplate.findMany({
      where: { code: input.code, locale: 'ar', isEnabled: true },
      select: { channel: true },
    });
    if (templates.length === 0) return 0;
    await db.notification.createMany({
      data: templates.map((t) => ({
        userId: input.userId!,
        channel: t.channel,
        templateCode: input.code,
        payloadJson: input.vars,
      })),
    });
    return templates.length;
  }

  /** لكل أصحاب متجر ومديريه — إشعار البائع يصل مالكه */
  async enqueueVendor(
    input: { code: string; vendorId: string; vars: Record<string, string> },
    db: Db = this.prisma,
  ): Promise<number> {
    const v = await db.vendor.findUnique({ where: { id: input.vendorId }, select: { ownerUserId: true, nameAr: true } });
    if (!v) return 0;
    return this.enqueue({ code: input.code, userId: v.ownerUserId, vars: { store_name: v.nameAr, ...input.vars } }, db);
  }

  // ------------------------------------------------------------- الإرسال

  async dispatch(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
    const out = { sent: 0, failed: 0, skipped: 0 };
    if (this.running) return out;
    this.running = true;
    try {
      const queued = await this.prisma.notification.findMany({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
      });
      for (const q of queued) {
        const r = await this.sendOne(q.id);
        if (r) out[r]++;
      }
      return out;
    } finally {
      this.running = false;
    }
  }

  private async sendOne(id: string): Promise<'sent' | 'failed' | 'skipped' | null> {
    // الحجز شرطيّ: نسختان من المرسِل لا ترسلان الإشعار نفسه مرتين
    const claimed = await this.prisma.notification.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'sending', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return null;
    const n = await this.prisma.notification.findUniqueOrThrow({ where: { id } });
    const channel = n.channel as Channel;

    const finish = async (status: 'sent' | 'failed' | 'skipped', data: Prisma.NotificationUpdateInput = {}) => {
      await this.prisma.notification.update({ where: { id }, data: { status, ...data } });
      return status;
    };

    try {
      const tpl = await this.prisma.notificationTemplate.findUnique({
        where: { code_channel_locale: { code: n.templateCode, channel, locale: 'ar' } },
      });
      if (!tpl || !tpl.isEnabled) return finish('skipped', { error: 'القالب غير مفعّل' });
      const vars = n.payloadJson as Record<string, string>;
      const subject = tpl.subject ? render(tpl.subject, vars) : null;
      const body = render(tpl.body, vars);

      const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true, phone: true } });
      let recipient: string | null = null;
      if (channel === 'in_app') recipient = n.userId;
      if (channel === 'email') recipient = user?.email ?? null;
      if (channel === 'sms' || channel === 'whatsapp') recipient = user?.phone ?? null;
      if (channel === 'push') {
        const sub = await this.prisma.pushSubscription.findFirst({ where: { userId: n.userId }, orderBy: { createdAt: 'desc' } });
        recipient = sub?.endpoint ?? null;
      }
      if (!recipient) {
        return finish('skipped', { subject, body, error: `لا عنوان لقناة ${CHANNEL_LABELS[channel]}` });
      }

      // داخل الموقع: الصف نفسه هو الرسالة
      const ref = channel === 'in_app' ? 'in_app' : await deliver({ id, channel, recipient, subject, body });
      return finish('sent', { subject, body, recipient, deliveryRef: ref, sentAt: new Date(), error: null });
    } catch (err) {
      const message = (err as Error).message;
      // خطأ القالب لا يُصلحه التكرار؛ خطأ القناة قد يُصلحه
      if (n.attempts < MAX_ATTEMPTS && !message.startsWith('متغيّر ناقص')) {
        await this.prisma.notification.update({ where: { id }, data: { status: 'queued', error: message } });
        return null;
      }
      return finish('failed', { error: message });
    }
  }

  // ------------------------------------------------------- داخل الموقع

  async inbox(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, channel: 'in_app', status: 'sent' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, templateCode: true, body: true, payloadJson: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { userId, channel: 'in_app', status: 'sent', readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((i) => ({
        id: i.id,
        code: i.templateCode,
        body: i.body,
        link: (i.payloadJson as Record<string, string>)['link'] ?? null,
        readAt: i.readAt,
        createdAt: i.createdAt,
      })),
    };
  }

  async markRead(userId: string, id?: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, channel: 'in_app', readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
  }

  async subscribePush(userId: string, input: { endpoint: string; keys: Record<string, string>; userAgent?: string | null }) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId, endpoint: input.endpoint, keysJson: input.keys, userAgent: input.userAgent ?? null },
      update: { userId, keysJson: input.keys },
    });
  }

  // ------------------------------------------------------------- الإدارة

  async matrix() {
    const rows = await this.prisma.notificationTemplate.findMany({ where: { locale: 'ar' } });
    return {
      channels: CHANNELS.map((c) => ({ code: c, label: CHANNEL_LABELS[c] })),
      events: EVENTS.map((e) => ({
        ...e,
        templates: rows
          .filter((r) => r.code === e.code)
          .map((r) => ({
            channel: r.channel,
            subject: r.subject,
            body: r.body,
            isEnabled: r.isEnabled,
            reviewedAt: r.reviewedAt,
            reviewedBy: r.reviewedBy,
            updatedAt: r.updatedAt,
          })),
      })),
    };
  }

  async saveTemplate(
    adminId: string,
    code: string,
    channel: Channel,
    input: { subject?: string | null; body: string; isEnabled?: boolean },
  ) {
    const ev = eventOf(code);
    if (!ev) throw new NotFoundError('حدث غير معروف.', { code });
    if (!CHANNELS.includes(channel)) throw new InvalidInputError('قناة غير معروفة.');
    if (channel === 'email' && !input.subject?.trim()) throw new InvalidInputError('البريد يحتاج عنواناً.');
    const unknown = usedVariables(`${input.subject ?? ''} ${input.body}`).filter((v) => !ev.variables.includes(v));
    if (unknown.length) {
      throw new InvalidInputError(`متغيّرات غير متاحة لهذا الحدث: ${unknown.join('، ')}`, { allowed: ev.variables });
    }
    // التعديل يُسقط المراجعة: نصّ جديد يحتاج قراءة جديدة
    const row = await this.prisma.notificationTemplate.upsert({
      where: { code_channel_locale: { code, channel, locale: 'ar' } },
      create: {
        code, channel, locale: 'ar', subject: input.subject?.trim() || null, body: input.body.trim(),
        variablesJson: [...ev.variables], isEnabled: input.isEnabled ?? true, updatedBy: adminId,
      },
      update: {
        subject: input.subject?.trim() || null, body: input.body.trim(), updatedAt: new Date(), updatedBy: adminId,
        reviewedAt: null, reviewedBy: null, ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: adminId, actorRole: 'admin', action: 'notification_template.save', entityType: 'NotificationTemplate', entityId: `${code}:${channel}`, afterJson: { subject: row.subject, body: row.body, isEnabled: row.isEnabled } },
    });
    return row;
  }

  async markReviewed(adminId: string, code: string, channel: Channel, reviewerName: string) {
    await this.prisma.notificationTemplate.update({
      where: { code_channel_locale: { code, channel, locale: 'ar' } },
      data: { reviewedAt: new Date(), reviewedBy: reviewerName },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: adminId, actorRole: 'admin', action: 'notification_template.review', entityType: 'NotificationTemplate', entityId: `${code}:${channel}` },
    });
  }

  preview(code: string, subject: string | null, body: string) {
    const ev = eventOf(code);
    if (!ev) throw new NotFoundError('حدث غير معروف.', { code });
    return { subject: subject ? render(subject, ev.sample) : null, body: render(body, ev.sample) };
  }

  /** «أرسل تجربة» — للمدير نفسه ببيانات العيّنة، ويُرسل فوراً */
  async sendTest(adminId: string, code: string, channel: Channel) {
    const ev = eventOf(code);
    if (!ev) throw new NotFoundError('حدث غير معروف.', { code });
    const n = await this.prisma.notification.create({
      data: { userId: adminId, channel, templateCode: code, payloadJson: { ...ev.sample } },
    });
    await this.sendOne(n.id);
    return this.prisma.notification.findUniqueOrThrow({
      where: { id: n.id },
      select: { id: true, status: true, error: true, recipient: true, subject: true, body: true, deliveryRef: true, sentAt: true },
    });
  }

  async log(filter: { status?: string; channel?: string }) {
    return this.prisma.notification.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.channel ? { channel: filter.channel } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, userId: true, channel: true, templateCode: true, status: true, error: true, recipient: true, subject: true, createdAt: true, sentAt: true, attempts: true },
    });
  }
}
