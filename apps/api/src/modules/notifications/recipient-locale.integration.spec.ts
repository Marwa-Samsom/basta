/**
 * الإشعار بلغة حساب صاحبه (4 نوفمبر 2026): من اختار الإنجليزية يصله نصّها ومتغيّراتها بها — المبلغ
 * «JOD 125.500» لا «125.500 د.أ.»، والحالة «Delivery failed» — ومن لم يخترها يصله بالعربية كما كان.
 * وما غاب نصّه الإنجليزي يصل بالعربية، وتشغيل القناة واحد للّغتين: الصفّ العربي أصله.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { format, money } from '../../common/money/money';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { defaultTemplate } from './domain/templates';
import { NotificationsService } from './public';

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma as unknown as PrismaService);
const sendOne = (id: string) => notifications['sendOne'](id);
// بعيداً: مُرسِل خادم التطوير على القاعدة نفسها لا يلتقطه قبلنا
const FAR = () => new Date(Date.now() + 24 * 3600_000);
const SUFFIX = `rloc${Date.now()}`;
const ARABIC = new RegExp(`[${String.fromCodePoint(0x0600)}-${String.fromCodePoint(0x06ff)}]`);
/** Intl يفصل رمز العملة عن الرقم بمسافة ثابتة (NBSP) — تُقرأ مسافة عادية في المقارنة */
const NBSP = new RegExp(String.fromCodePoint(0xa0), 'g');
const plain = (v: string | null | undefined): string => (v ?? '').replace(NBSP, ' ');
const AMOUNT = format(money(125_500n, 'JOD'), 'ar');
const ORDER = 'BST-261104-LANG0001';
let dbUp = false;
const users = { en: '', ar: '' };
let vendorId = '';

async function send(userId: string, templateCode: string, channel: string, vars: Record<string, string>) {
  const { id } = await prisma.notification.create({ data: { userId, channel, templateCode, payloadJson: vars, nextAttemptAt: FAR() }, select: { id: true } });
  await sendOne(id);
  return prisma.notification.findUniqueOrThrow({ where: { id }, select: { status: true, subject: true, body: true, error: true } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  // القوالب الإنجليزية تُزرع مع العربية عند الإقلاع — وهنا بلا إقلاع
  await notifications.ensureDefaults();
  const make = async (locale: 'ar' | 'en') =>
    (await prisma.user.create({ data: { email: `${locale}.${SUFFIX}@basta.test`, fullName: `مستخدم ${locale}`, locale }, select: { id: true } })).id;
  users.en = await make('en');
  users.ar = await make('ar');
  vendorId = (
    await prisma.vendor.create({
      data: { ownerUserId: users.en, slug: `v-${SUFFIX}`, nameAr: 'متجر الورد', nameEn: 'Rose Store', status: 'approved', approvedAt: new Date(), settlementCurrency: 'JOD', country: 'JO' },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  if (dbUp) {
    const ids = [users.en, users.ar].filter(Boolean);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    if (vendorId) await prisma.vendor.delete({ where: { id: vendorId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('الإشعار بلغة حساب صاحبه', () => {
  it('تأكيد الطلب: الإنجليزي بنصّه ومبلغه وتحيّته بالإنجليزية — والعربي كما كان', async () => {
    if (!dbUp) return;
    const vars = { name: 'عميلنا', order_number: ORDER, amount: AMOUNT, store_count: '1', link: `/account/orders/${ORDER}` };

    const mail = await send(users.en, 'order_placed', 'email', vars);
    expect(mail.status, mail.error ?? '').toBe('sent');
    expect(mail.subject).toBe(`Your order ${ORDER} is confirmed`);
    expect(plain(mail.body)).toContain('Hi there,');
    expect(plain(mail.body)).toContain('your payment of JOD 125.500.');
    // «1 stores» ← «1 store»
    expect(plain(mail.body)).toContain('It comes from 1 store,');
    expect(mail.body).not.toMatch(ARABIC);

    const inApp = await send(users.en, 'order_placed', 'in_app', vars);
    expect(plain(inApp.body)).toBe(`Your order ${ORDER} is confirmed — JOD 125.500.`);

    // العربي كما كان: نصّه ومبلغه بالعربية
    const ar = await send(users.ar, 'order_placed', 'in_app', vars);
    expect(ar.body).toBe(`طلبك ${ORDER} مؤكَّد — ${AMOUNT}`);
    const arMail = await send(users.ar, 'order_placed', 'email', vars);
    expect(arMail.subject).toBe(`طلبك ${ORDER} مؤكَّد`);
    expect(arMail.body).toContain('مرحباً عميلنا');
  });

  it('ما يكتبه الكود يُترجم وما كتبه إنسان يبقى: «Delivery failed» واسم المتجر كما كتبه', async () => {
    if (!dbUp) return;
    const vars = { name: 'سارة', store_name: 'متجر الورد', order_number: ORDER, status: 'تعذّر التوصيل', link: `/account/orders/${ORDER}` };
    const inApp = await send(users.en, 'order_status_changed', 'in_app', vars);
    expect(inApp.body).toBe(`متجر الورد: Delivery failed for order ${ORDER}.`);
    const mail = await send(users.en, 'order_status_changed', 'email', vars);
    expect(mail.subject).toBe(`Your order ${ORDER}: Delivery failed`);
    expect(mail.body).toContain('Hi سارة,');
  });

  it('إشعار المتجر لصاحبه الإنجليزي باسمه الإنجليزي الذي كتبه', async () => {
    if (!dbUp) return;
    await notifications.enqueueVendor({
      code: 'vendor_new_order',
      vendorId,
      vars: { order_number: `${ORDER}-1`, amount: AMOUNT, deadline_hours: '1', link: '/vendor/orders' },
    });
    const queued = await prisma.notification.findFirstOrThrow({ where: { userId: users.en, templateCode: 'vendor_new_order', channel: 'in_app' } });
    // بعيداً عن مُرسِل خادم التطوير، ثم نرسله نحن
    await prisma.notification.updateMany({ where: { userId: users.en, templateCode: 'vendor_new_order' }, data: { nextAttemptAt: FAR() } });
    expect(queued.payloadJson).toMatchObject({ store_name: 'متجر الورد', store_name_en: 'Rose Store' });
    await sendOne(queued.id);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: queued.id } });
    // «1 hours» ← «1 hour»
    expect(plain(row.body)).toBe(`New order ${ORDER}-1 — JOD 125.500. Deadline: 1 hour.`);
    const mail = await prisma.notification.findFirstOrThrow({ where: { userId: users.en, templateCode: 'vendor_new_order', channel: 'email' } });
    await sendOne(mail.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mail.id } })).body).toMatch(/^Rose Store team,/);
  });

  it('ما غاب نصّه الإنجليزي يصل بالعربية — لا يسقط الإشعار', async () => {
    if (!dbUp) return;
    const key = { code: 'order_status_changed', channel: 'push', locale: 'en' } as const;
    await prisma.notificationTemplate.delete({ where: { code_channel_locale: key } });
    try {
      // بلا اشتراك دفع: يُختم «لا عنوان» بعد كتابة نصّه — وهو ما نقرؤه
      const r = await send(users.en, 'order_status_changed', 'push', { name: 'سارة', store_name: 'متجر الورد', order_number: ORDER, status: 'تعذّر التوصيل', link: '/account' });
      expect(r.error).toMatch(/لا عنوان/);
      expect(r.body).toBe(`متجر الورد: تعذّر التوصيل — الطلب ${ORDER}`);
    } finally {
      await notifications.ensureDefaults();
    }
    expect(await prisma.notificationTemplate.count({ where: key })).toBe(1);
  });

  it('تشغيل القناة واحد للّغتين: إطفاؤها من النصّ الإنجليزي يطفئ العربي، والعربي المطفأ لا يصل بالإنجليزية', async () => {
    if (!dbUp) return;
    const code = 'order_status_changed';
    const channel = 'push';
    const en = defaultTemplate(code, channel, 'en')!;
    const vars = { name: 'سارة', store_name: 'متجر الورد', order_number: ORDER, status: 'تعذّر التوصيل', link: '/account' };
    const enabled = () => prisma.notificationTemplate.findMany({ where: { code, channel }, select: { locale: true, isEnabled: true }, orderBy: { locale: 'asc' } });
    // قاعدة التطوير مشتركة: الصفّان يعودان كما كانا تماماً، بمراجعتهما وتاريخهما
    const before = await prisma.notificationTemplate.findMany({ where: { code, channel } });
    try {
      // التعديل من الإنجليزية: نصّها وحده، والتشغيل للاثنين
      await notifications.saveTemplate(users.ar, code, channel, { body: `${en.body} (edited)`, isEnabled: false }, 'en');
      expect(await enabled()).toEqual([{ locale: 'ar', isEnabled: false }, { locale: 'en', isEnabled: false }]);
      expect((await prisma.notificationTemplate.findUniqueOrThrow({ where: { code_channel_locale: { code, channel, locale: 'ar' } } })).body).toBe(defaultTemplate(code, channel)!.body);
      expect((await send(users.en, code, channel, vars)).error).toBe('القالب غير مفعّل');

      // الإنجليزي مفعّل في صفّه والعربي مطفأ: لا يصل — العربي أصل التشغيل
      await prisma.notificationTemplate.update({ where: { code_channel_locale: { code, channel, locale: 'en' } }, data: { isEnabled: true } });
      expect((await send(users.en, code, channel, vars)).error).toBe('القالب غير مفعّل');
    } finally {
      for (const r of before) {
        await prisma.notificationTemplate.update({
          where: { code_channel_locale: { code: r.code, channel: r.channel, locale: r.locale } },
          data: { subject: r.subject, body: r.body, isEnabled: r.isEnabled, reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy, updatedAt: r.updatedAt, updatedBy: r.updatedBy },
        });
      }
    }
    expect(await enabled()).toEqual([{ locale: 'ar', isEnabled: true }, { locale: 'en', isEnabled: true }]);
    // ونصّه المعدَّل بالإنجليزية يصل من اختارها
    const back = await send(users.en, code, channel, vars);
    expect(back.body).toBe(`متجر الورد: Delivery failed — order ${ORDER}`);
  });

  it('المعاينة بالإنجليزية بمتغيّرات العيّنة كما تصل صاحبها — والمصفوفة تعرض النصّين', async () => {
    if (!dbUp) return;
    const en = defaultTemplate('order_awaiting_transfer', 'email', 'en')!;
    const p = notifications.preview('order_awaiting_transfer', en.subject, en.body, 'en');
    expect(plain(p.body)).toContain('Transfer exactly JOD 125.500 to:');
    expect(p.body).toContain('CliQ: BASTA');
    expect(p.body).toContain('Your items are reserved until 16 October 2026 at 15:00.');
    // والعربية كما كانت
    const ar = defaultTemplate('order_awaiting_transfer', 'email')!;
    expect(notifications.preview('order_awaiting_transfer', ar.subject, ar.body).body).toContain('16 أكتوبر 2026، 3:00 م');

    const m = await notifications.matrix();
    const placed = m.events.find((e) => e.code === 'order_placed')!;
    expect(placed.templatesEn.map((t) => t.channel).sort()).toEqual(placed.templates.map((t) => t.channel).sort());
    expect(placed.templatesEn.find((t) => t.channel === 'in_app')?.body).toBe('Your order {{order_number}} is confirmed — {{amount}}.');
  });
});
