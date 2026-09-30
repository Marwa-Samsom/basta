import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CHANNELS,
  CHANNEL_LABELS,
  defaultTemplate,
  DEFAULT_TEMPLATES,
  EVENTS,
  eventOf,
  PREF_CATEGORIES,
  prefCategoryOf,
  redactVars,
  render,
  usedVariables,
  type Channel,
} from '../domain/templates';
import { deliver } from '../infrastructure/channels';

type Db = Prisma.TransactionClient | PrismaService;

/** JSON المخزَّن كما هو — ما ليس قيمة منطقية يُهمَل */
function prefsOf(raw: Prisma.JsonValue | undefined): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
}

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
    await this.enforceProtected();
    return r.count;
  }

  /**
   * ما عُبث به في القاعدة قبل القفل لا يبقى: المقفول يعود نصّ الكود وتُحذف
   * قنواته المضافة، والتنبيه الإلزامي يعود مفعّلاً. يُكتب المختلف وحده، فلا
   * يتحرّك «آخر تعديل» عند كل إقلاع.
   */
  private async enforceProtected(): Promise<void> {
    for (const ev of EVENTS) {
      if (ev.locked) {
        const seeds = DEFAULT_TEMPLATES.filter((t) => t.code === ev.code);
        await this.prisma.notificationTemplate.deleteMany({
          where: { code: ev.code, channel: { notIn: seeds.map((s) => s.channel) } },
        });
        const rows = await this.prisma.notificationTemplate.findMany({ where: { code: ev.code, locale: 'ar' } });
        for (const row of rows) {
          const seed = seeds.find((s) => s.channel === row.channel)!;
          if (row.subject === seed.subject && row.body === seed.body && row.isEnabled) continue;
          await this.prisma.notificationTemplate.update({
            where: { code_channel_locale: { code: row.code, channel: row.channel, locale: row.locale } },
            data: { subject: seed.subject, body: seed.body, isEnabled: true, updatedAt: new Date(), updatedBy: null },
          });
        }
      } else if (ev.mandatory) {
        await this.prisma.notificationTemplate.updateMany({ where: { code: ev.code, isEnabled: false }, data: { isEnabled: true } });
      }
    }
  }

  // ------------------------------------------------------------ الإدراج

  async enqueue(
    input: { code: string; userId: string | null | undefined; vars: Record<string, string> },
    db: Db = this.prisma,
  ): Promise<number> {
    if (!input.userId) return 0;
    // المقفول: قنواته من الكود — قناة أُضيفت في القاعدة لا توصل رمزاً إلى مكان آخر
    let templates = eventOf(input.code)?.locked
      ? DEFAULT_TEMPLATES.filter((t) => t.code === input.code).map((t) => ({ channel: t.channel }))
      : await db.notificationTemplate.findMany({
          where: { code: input.code, locale: 'ar', isEnabled: true },
          select: { channel: true },
        });
    // فئة أطفأها صاحبها: داخل الموقع وحده — لا يضيع شيء، يصل أهدأ فقط
    const category = prefCategoryOf(input.code);
    if (category) {
      const u = await db.user.findUnique({ where: { id: input.userId }, select: { notificationPrefs: true } });
      if (prefsOf(u?.notificationPrefs)[category] === false) templates = templates.filter((t) => t.channel === 'in_app');
    }
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

  // ------------------------------------------------------ التفضيلات

  /** VD-20 — كل الفئات مع حالتها؛ الغائب من المخزَّن مُشغَّل */
  async preferences(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { notificationPrefs: true } });
    const stored = prefsOf(u.notificationPrefs);
    return {
      items: PREF_CATEGORIES.map((c) => ({ key: c.key, labelAr: c.labelAr, noteAr: c.noteAr, email: stored[c.key] !== false })),
    };
  }

  async setPreferences(userId: string, patch: Record<string, boolean>) {
    const known = new Set<string>(PREF_CATEGORIES.map((c) => c.key));
    const unknown = Object.keys(patch).filter((k) => !known.has(k));
    if (unknown.length) throw new InvalidInputError('فئة إشعار غير معروفة.', { unknown });
    if (Object.values(patch).some((v) => typeof v !== 'boolean')) throw new InvalidInputError('قيمة التفضيل تشغيل أو إطفاء.');
    await this.prisma.$transaction(async (tx) => {
      // قفل الصف: مفتاحان من تبويبين في اللحظة نفسها لا يمحو أحدهما الآخر
      await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { notificationPrefs: true } });
      await tx.user.update({ where: { id: userId }, data: { notificationPrefs: { ...prefsOf(u.notificationPrefs), ...patch } } });
    });
    return this.preferences(userId);
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
    const ev = eventOf(n.templateCode);
    const vars = n.payloadJson as Record<string, string>;
    const secret = (ev?.secret?.length ?? 0) > 0;

    // الختام يمحو الأسرار: الرمز يصل صاحبه ثم لا يبقى في صفّ يقرؤه السجل
    const finish = async (status: 'sent' | 'failed' | 'skipped', data: Prisma.NotificationUpdateInput = {}) => {
      const scrubbed = secret ? { payloadJson: redactVars(n.templateCode, vars) } : {};
      await this.prisma.notification.update({ where: { id }, data: { status, ...data, ...scrubbed } });
      return status;
    };

    try {
      // المقفول يُرسل بنصّ الكود وحده — صفّه في القاعدة للعرض لا للإرسال
      const tpl = ev?.locked
        ? (() => {
            const d = defaultTemplate(n.templateCode, channel);
            return d ? { subject: d.subject, body: d.body, isEnabled: true } : null;
          })()
        : await this.prisma.notificationTemplate.findUnique({
            where: { code_channel_locale: { code: n.templateCode, channel, locale: 'ar' } },
          });
      if (!tpl || !tpl.isEnabled) return finish('skipped', { error: 'القالب غير مفعّل' });
      const subject = tpl.subject ? render(tpl.subject, vars) : null;
      const body = render(tpl.body, vars);
      // ما يُخزَّن: النص نفسه والسرّ محجوب
      const shown = secret ? redactVars(n.templateCode, vars) : vars;
      const stored = {
        subject: secret ? (tpl.subject ? render(tpl.subject, shown) : null) : subject,
        body: secret ? render(tpl.body, shown) : body,
      };

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
        return finish('skipped', { ...stored, error: `لا عنوان لقناة ${CHANNEL_LABELS[channel]}` });
      }

      // داخل الموقع: الصف نفسه هو الرسالة
      const ref = channel === 'in_app' ? 'in_app' : await deliver({ id, channel, recipient, subject, body });
      return finish('sent', { ...stored, recipient, deliveryRef: ref, sentAt: new Date(), error: null });
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

  /**
   * صندوق الإشعارات داخل الموقع.
   *
   * بلا خيارات يعود كما كان دائماً (آخر 30) — الجرس في الرأس يعتمد عليه.
   * ومركز الإشعارات (ST-27) يطلب صفحة بعد صفحة بمؤشّر `before` (معرّف آخر
   * إشعار رآه)، ويصفّي غير المقروء. الترتيب (الوقت، ثم المعرّف) ثابت، فلا
   * يتكرّر إشعار بين صفحتين ولا يسقط، ولو تساوى وقتا إشعارين.
   * المؤشّر نفسه يُقرأ في نطاق المستخدم: معرّف إشعار غيره لا يعني شيئاً.
   */
  async inbox(userId: string, opts: { before?: string; limit?: number; unreadOnly?: boolean } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
    const base: Prisma.NotificationWhereInput = { userId, channel: 'in_app', status: 'sent' };
    let after: Prisma.NotificationWhereInput = {};
    if (opts.before) {
      const cursor = await this.prisma.notification.findFirst({
        where: { ...base, id: opts.before },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new NotFoundError('انتهت صلاحية موضع التصفّح. حدّث الصفحة.');
      after = {
        OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
      };
    }
    const where: Prisma.NotificationWhereInput = { ...base, ...after, ...(opts.unreadOnly ? { readAt: null } : {}) };
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: { id: true, templateCode: true, body: true, payloadJson: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { ...base, readAt: null } }),
    ]);
    const items = rows.slice(0, limit);
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
      nextCursor: rows.length > limit ? items[items.length - 1]!.id : null,
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
    if (ev.locked) {
      throw new ConflictError('قالب رمز أمان: نصّه وقنواته مثبّتة في الكود ولا تُحرَّر من اللوحة، حتى لا يُكشف الرمز.');
    }
    if (ev.mandatory && input.isEnabled === false) {
      throw new ConflictError('تنبيه أمن إلزامي: يُحرَّر نصّه ولا يُوقف، فإيقافه يُخفي عن صاحب الحساب أن حسابه في خطر.');
    }
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
