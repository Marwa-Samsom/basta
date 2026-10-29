/**
 * الرابط خارج الموقع كاملاً: البريد لا يعرف الموقع، فـ«/vendor/orders» في نصّه لا يُضغط ولا يوصل
 * (VOPS-064، 29 أكتوبر 2026). داخل الموقع يبقى مساراً — الصندوق يفتحه في الموقع نفسه.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './public';

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma as unknown as PrismaService);
const sendOne = (id: string) => notifications['sendOne'](id);
// بعيداً: مُرسِل خادم التطوير على القاعدة نفسها لا يلتقطه قبلنا
const FAR = () => new Date(Date.now() + 24 * 3600_000);
const SITE = (process.env['NEXT_PUBLIC_SITE_URL'] ?? '').replace(/\/+$/, '');
let dbUp = false;
let userId = '';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  userId = (await prisma.user.create({ data: { email: `links${Date.now()}@basta.test`, fullName: 'مالك الروابط' }, select: { id: true } })).id;
});

afterAll(async () => {
  if (dbUp && userId) {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('رابط الإشعار في البريد', () => {
  it('«طلب جديد» بالبريد برابط كامل إلى لوحة الطلبات — وداخل الموقع بالمسار', async () => {
    if (!dbUp) return;
    expect(SITE, 'NEXT_PUBLIC_SITE_URL').toMatch(/^https?:\/\//);
    const vars = { order_number: 'BST-261029-LINK0001-1', amount: '128.85 ر.س.', store_name: 'متجر الروابط', deadline_hours: '48', link: '/vendor/orders' };
    const make = async (channel: string) =>
      (await prisma.notification.create({ data: { userId, channel, templateCode: 'vendor_new_order', payloadJson: vars, nextAttemptAt: FAR() }, select: { id: true } })).id;
    const email = await make('email');
    const inApp = await make('in_app');
    await sendOne(email);
    await sendOne(inApp);
    const row = (id: string) => prisma.notification.findUniqueOrThrow({ where: { id }, select: { status: true, body: true, payloadJson: true } });

    const mail = await row(email);
    expect(mail.status).toBe('sent');
    expect(mail.body).toContain(`${SITE}/vendor/orders`);
    // لا مسار عارٍ في سطر وحده
    expect(mail.body).not.toMatch(/(^|\s)\/vendor\/orders/m);

    // الصفّ يحفظ المسار: الصندوق داخل الموقع يفتحه نسبةً إليه
    const inside = await row(inApp);
    expect((inside.payloadJson as Record<string, string>)['link']).toBe('/vendor/orders');
  });
});
