import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { arabicCounts } from '../../../common/arabic-count';
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
  seedsOf,
  TEMPLATE_LOCALES,
  usedVariables,
  type Channel,
  type TemplateLocale,
} from '../domain/templates';
import { englishCounts, englishVars, storeNameVars } from '../domain/english-vars';
import { MAX_ATTEMPTS, SENDING_LEASE_SECONDS, nextAttemptAt } from '../domain/retry';
import { deliver } from '../infrastructure/channels';

type Db = Prisma.TransactionClient | PrismaService;

/** JSON المخزَّن كما هو — ما ليس قيمة منطقية يُهمَل */
function prefsOf(raw: Prisma.JsonValue | undefined): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
}

const EVERY_FIVE_SECONDS = 5_000;

/**
 * القالب مملوءاً، والعدد ومعدوده فيه بالعربية — «خلال 9 ساعة» في القاعدة تصير «خلال 9 ساعات»
 * (VOPS-019، 29 أكتوبر 2026). نصوص القوالب تُزرع في القاعدة مرة ولا يكتب الكود فوقها.
 */
const fill = (text: string, vars: Readonly<Record<string, string>>, locale: TemplateLocale = 'ar'): string =>
  locale === 'en' ? englishCounts(render(text, vars)) : arabicCounts(render(text, vars));

/** لغة الحساب كما حُفظت — ما ليس «en» عربي */
const localeOf = (raw: string | null | undefined): TemplateLocale => (raw === 'en' ? 'en' : 'ar');

/**
 * الرابط خارج الموقع كاملاً: البريد والرسالة لا يعرفان الموقع، فـ«/vendor/orders» في نصّهما لا يُضغط ولا
 * يوصل (VOPS-064، 29 أكتوبر 2026). داخل الموقع والإشعار المنبثق يبقيان بالمسار، والصفّ يحفظ المسار
 */
const OUTSIDE_SITE: ReadonlySet<Channel> = new Set(['email', 'sms', 'whatsapp']);
const withSiteLink = (vars: Record<string, string>, channel: Channel): Record<string, string> => {
  const site = process.env['NEXT_PUBLIC_SITE_URL']?.replace(/\/+$/, '');
  const link = vars['link'];
  if (!OUTSIDE_SITE.has(channel) || !site || !link?.startsWith('/')) return vars;
  return { ...vars, link: `${site}${link}` };
};

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
      // العربية أصل، والإنجليزية بجانبها لمن لغة حسابه الإنجليزية (4 نوفمبر 2026)
      data: TEMPLATE_LOCALES.flatMap((locale) => seedsOf(locale).map((t) => ({ ...t, locale }))).map((t) => ({
        code: t.code,
        channel: t.channel,
        locale: t.locale,
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
        const rows = await this.prisma.notificationTemplate.findMany({ where: { code: ev.code } });
        for (const row of rows) {
          const seed = seedsOf(localeOf(row.locale)).find((s) => s.code === ev.code && s.channel === row.channel);
          if (!seed) continue;
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
    const v = await db.vendor.findUnique({ where: { id: input.vendorId }, select: { ownerUserId: true, nameAr: true, nameEn: true } });
    if (!v) return 0;
    const vars: Record<string, string> = { ...storeNameVars(v), ...input.vars };
    // حدث يكتب اسماً آخر للمتجر: لا يبقى الإنجليزي لاسم غيره
    if (vars['store_name'] !== v.nameAr) delete vars['store_name_en'];
    return this.enqueue({ code: input.code, userId: v.ownerUserId, vars }, db);
  }

  /**
   * لمديري المنصة الذين يحملون الصلاحية وحدهم — لا كل مدير: نزاع لا يحسمه إلا من يحمل
   * disputes.resolve، وسحب لا يقرّه إلا من يحمل payouts.approve. المالك كغيره بصلاحياته
   * المحفوظة، كما يفحصها الحارس. والمعلَّق أو المحذوف لا يصله شيء.
   */
  async enqueueAdmins(
    input: { code: string; permission: string; vars: Record<string, string> },
    db: Db = this.prisma,
  ): Promise<number> {
    const admins = await db.user.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        roles: { some: { role: 'admin' } },
        permissions: { some: { permission: input.permission } },
      },
      select: { id: true },
    });
    let queued = 0;
    for (const a of admins) queued += await this.enqueue({ code: input.code, userId: a.id, vars: input.vars }, db);
    return queued;
  }

  /**
   * تنبيه الإدارة مرة لكل حالة — للمهام الدورية التي ترى الحالة في كل دورة. المفتاح يصف
   * الحالة نفسها، و `skipDuplicates` على مفتاح فريد يجعل دورتين متزامنتين ترسلان مرة.
   * يعيد هل أُرسل الآن.
   */
  async alertAdminsOnce(
    key: string,
    input: { code: string; permission: string; vars: Record<string, string> },
    db: Db = this.prisma,
  ): Promise<boolean> {
    const { count } = await db.adminAlert.createMany({ data: [{ key }], skipDuplicates: true });
    if (count === 0) return false;
    await this.enqueueAdmins(input, db);
    return true;
  }

  // ------------------------------------------------------------- الإرسال

  /**
   * الأقدم أولاً بدفعات. `only.userIds` يقصر الدفعة على رسائل هؤلاء: اختبارٌ ينتظر رسالته بعينها
   * كان يرسل قبلها صندوق الملفات الأخرى كله — مئات عبر خادم بريده — فتنقضي مهلته مع الحزمة
   * كلها (password-recovery-smtp، 4 نوفمبر 2026). المرسِل الدوري يبقى على الصندوق كله.
   */
  async dispatch(limit = 50, only?: { userIds: readonly string[] }): Promise<{ sent: number; failed: number; skipped: number }> {
    const out = { sent: 0, failed: 0, skipped: 0 };
    if (this.running) return out;
    this.running = true;
    try {
      const now = new Date();
      const queued = await this.prisma.notification.findMany({
        where: {
          ...(only ? { userId: { in: [...only.userIds] } } : {}),
          OR: [
            // ما فشل قبلاً ينتظر موعده: الإعادة بمهلة تطول لا كل 5 ثوانٍ (domain/retry.ts)
            { status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
            // سقط مرسِله بين الحجز والختام: انقضت مهلة «يُرسل» ولم يُختم
            { status: 'sending', nextAttemptAt: { lte: now } },
          ],
        },
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

  private async sendOne(id: string, forced?: TemplateLocale): Promise<'sent' | 'failed' | 'skipped' | null> {
    // الحجز شرطيّ: نسختان من المرسِل لا ترسلان الإشعار نفسه مرتين. ويُحجز بمهلة: إن سقط
    // المرسِل قبل الختام التقطه غيره بعدها، ولا يلتقطه أحد قبلها (SYS-034)
    const now = new Date();
    const claimed = await this.prisma.notification.updateMany({
      where: { id, OR: [{ status: 'queued' }, { status: 'sending', nextAttemptAt: { lte: now } }] },
      data: { status: 'sending', attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + SENDING_LEASE_SECONDS * 1000) },
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
      await this.prisma.notification.update({ where: { id }, data: { status, ...data, ...scrubbed, nextAttemptAt: null } });
      return status;
    };

    // سقط المرسِل أثناء المحاولة الأخيرة: يُختم ولا يُعاد بلا حدّ — قد يكون الإشعار نفسه ما يُسقطه
    if (n.attempts > MAX_ATTEMPTS) return finish('failed', { error: 'استُنفدت المحاولات: سقط الخادم أثناء آخرها.' });

    try {
      // بلغة حساب صاحبه: الإنجليزية لمن اختارها، ونصّها ومتغيّراتها بها — وما غاب نصّه بها يصل بالعربية
      const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true, phone: true, locale: true } });
      // «أرسل تجربة لي» من النصّ الإنجليزي تصل بالإنجليزية أيّاً كانت لغة حساب المدير
      const wanted = forced ?? localeOf(user?.locale);
      // المقفول يُرسل بنصّ الكود وحده — صفّه في القاعدة للعرض لا للإرسال
      const tpl = ev?.locked
        ? (() => {
            const own = defaultTemplate(n.templateCode, channel, wanted);
            const d = own ?? defaultTemplate(n.templateCode, channel);
            return d ? { subject: d.subject, body: d.body, isEnabled: true, locale: own ? wanted : 'ar' } : null;
          })()
        : await this.textOf(n.templateCode, channel, wanted);
      if (!tpl || !tpl.isEnabled) return finish('skipped', { error: 'القالب غير مفعّل' });
      const locale = localeOf(tpl.locale);
      const sent = withSiteLink(locale === 'en' ? englishVars(vars) : vars, channel);
      const subject = tpl.subject ? fill(tpl.subject, sent, locale) : null;
      const body = fill(tpl.body, sent, locale);
      // ما يُخزَّن: النص نفسه والسرّ محجوب
      const shown = secret ? redactVars(n.templateCode, sent) : sent;
      const stored = {
        subject: secret ? (tpl.subject ? fill(tpl.subject, shown, locale) : null) : subject,
        body: secret ? fill(tpl.body, shown, locale) : body,
      };

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
      // خطأ القالب لا يُصلحه التكرار؛ خطأ القناة قد يُصلحه — بعد مهلة تطول مع كل فشل
      const retryAt = message.startsWith('متغيّر ناقص') ? null : nextAttemptAt(n.attempts, new Date());
      if (retryAt) {
        await this.prisma.notification.update({ where: { id }, data: { status: 'queued', error: message, nextAttemptAt: retryAt } });
        return null;
      }
      return finish('failed', { error: message });
    }
  }

  /**
   * نصّ القالب بلغة المستلم. التشغيل والإيقاف للقناة من صفّها العربي — أصلها، ومنه يختار enqueue
   * القنوات — والنصّ من صفّ اللغة المطلوبة إن وُجد، وإلا العربي.
   */
  private async textOf(code: string, channel: Channel, locale: TemplateLocale) {
    const rows = await this.prisma.notificationTemplate.findMany({ where: { code, channel, locale: { in: ['ar', locale] } } });
    const ar = rows.find((r) => r.locale === 'ar');
    if (!ar) return null;
    const text = rows.find((r) => r.locale === locale) ?? ar;
    return { subject: text.subject, body: text.body, isEnabled: ar.isEnabled, locale: text.locale };
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
   *
   * و`codes` يصفّي برموز القوالب (رقائق صندوق اللوحة: الطلبات، المال…)، و`counts` يعيد عدد
   * كل رمز في الصندوق كله — كانت الرقائق تصفّي ما جُلب وتعدّه وحده (3 نوفمبر 2026).
   * و`total` عدد ما في العرض كله، لا الصفحة.
   */
  async inbox(userId: string, opts: { before?: string; limit?: number; unreadOnly?: boolean; codes?: string[]; counts?: boolean } = {}) {
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
    const view: Prisma.NotificationWhereInput = {
      ...base,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.codes ? { templateCode: { in: opts.codes } } : {}),
    };
    const [rows, unread, total, byCode] = await Promise.all([
      this.prisma.notification.findMany({
        where: { ...view, ...after },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: { id: true, templateCode: true, body: true, payloadJson: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { ...base, readAt: null } }),
      this.prisma.notification.count({ where: view }),
      opts.counts ? this.prisma.notification.groupBy({ by: ['templateCode'], where: base, _count: true }) : null,
    ]);
    const items = rows.slice(0, limit);
    return {
      unread,
      /** إشعارات العرض كلها (الكل، أو غير المقروء، أو رموز التصفية) — «X من Y» تحت القائمة */
      total,
      ...(byCode ? { counts: Object.fromEntries(byCode.map((g) => [g.templateCode, g._count])) as Record<string, number> } : {}),
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
    const rows = await this.prisma.notificationTemplate.findMany();
    const textOf = (r: (typeof rows)[number]) => ({
      channel: r.channel,
      subject: r.subject,
      body: r.body,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      updatedAt: r.updatedAt,
    });
    return {
      channels: CHANNELS.map((c) => ({ code: c, label: CHANNEL_LABELS[c] })),
      events: EVENTS.map((e) => ({
        ...e,
        // العيّنة كما تصل من لغة حسابه الإنجليزية — بها يعاين المحرّر النصّ الإنجليزي
        sampleEn: englishVars(e.sample),
        // العربية أصل القناة وتشغيلها، والإنجليزية نصّها لمن لغة حسابه الإنجليزية
        templates: rows.filter((r) => r.code === e.code && r.locale === 'ar').map((r) => ({ ...textOf(r), isEnabled: r.isEnabled })),
        templatesEn: rows.filter((r) => r.code === e.code && r.locale === 'en').map(textOf),
      })),
    };
  }

  async saveTemplate(
    adminId: string,
    code: string,
    channel: Channel,
    input: { subject?: string | null; body: string; isEnabled?: boolean },
    locale: TemplateLocale = 'ar',
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
      where: { code_channel_locale: { code, channel, locale } },
      create: {
        code, channel, locale, subject: input.subject?.trim() || null, body: input.body.trim(),
        variablesJson: [...ev.variables], isEnabled: input.isEnabled ?? true, updatedBy: adminId,
      },
      update: {
        subject: input.subject?.trim() || null, body: input.body.trim(), updatedAt: new Date(), updatedBy: adminId,
        reviewedAt: null, reviewedBy: null, ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      },
    });
    // التشغيل للقناة كلها بلغتيها — الصفّ العربي أصله، فلا يُطفأ بالإنجليزية وحدها ما يُرسل بالعربية
    if (input.isEnabled !== undefined) {
      await this.prisma.notificationTemplate.updateMany({ where: { code, channel }, data: { isEnabled: input.isEnabled } });
    }
    await this.prisma.auditLog.create({
      data: { actorUserId: adminId, actorRole: 'admin', action: 'notification_template.save', entityType: 'NotificationTemplate', entityId: `${code}:${channel}${locale === 'en' ? ':en' : ''}`, afterJson: { subject: row.subject, body: row.body, isEnabled: input.isEnabled ?? row.isEnabled, locale } },
    });
    return row;
  }

  async markReviewed(adminId: string, code: string, channel: Channel, reviewerName: string, locale: TemplateLocale = 'ar') {
    await this.prisma.notificationTemplate.update({
      where: { code_channel_locale: { code, channel, locale } },
      data: { reviewedAt: new Date(), reviewedBy: reviewerName },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: adminId, actorRole: 'admin', action: 'notification_template.review', entityType: 'NotificationTemplate', entityId: `${code}:${channel}${locale === 'en' ? ':en' : ''}` },
    });
  }

  preview(code: string, subject: string | null, body: string, locale: TemplateLocale = 'ar') {
    const ev = eventOf(code);
    if (!ev) throw new NotFoundError('حدث غير معروف.', { code });
    // العيّنة كما تصل صاحبها: متغيّراتها بالإنجليزية للنصّ الإنجليزي، والأسماء كما هي
    const vars = locale === 'en' ? englishVars(ev.sample) : ev.sample;
    return { subject: subject ? fill(subject, vars, locale) : null, body: fill(body, vars, locale) };
  }

  /** «أرسل تجربة» — للمدير نفسه ببيانات العيّنة، ويُرسل فوراً */
  async sendTest(adminId: string, code: string, channel: Channel, locale?: TemplateLocale) {
    const ev = eventOf(code);
    if (!ev) throw new NotFoundError('حدث غير معروف.', { code });
    const n = await this.prisma.notification.create({
      data: { userId: adminId, channel, templateCode: code, payloadJson: { ...ev.sample } },
    });
    await this.sendOne(n.id, locale);
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
