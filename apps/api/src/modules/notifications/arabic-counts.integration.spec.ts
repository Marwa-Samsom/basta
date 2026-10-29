/**
 * نصّ الإشعار بالعدد العربي ولو كان قالبه في القاعدة «{{hours}} ساعة» (VOPS-019، 29 أكتوبر 2026). القوالب
 * تُزرع مرة ولا يكتب الكود فوقها، فالتصحيح بعد ملء المتغيّر — كانت إشعارات الإدارة «يُلغى آلياً خلال 9 ساعة».
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
let dbUp = false;
let userId = '';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  userId = (await prisma.user.create({ data: { email: `counts${Date.now()}@basta.test`, fullName: 'مدير العدد' }, select: { id: true } })).id;
});

afterAll(async () => {
  if (dbUp && userId) {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('العدد ومعدوده في نصّ الإشعار', () => {
  it('«قارب مهلة القبول» خلال 9 ساعات، و«مرتجع عالق» منذ 11 يوماً — لا «9 ساعة» ولا «11 أيام»', async () => {
    if (!dbUp) return;
    const make = async (templateCode: string, payloadJson: Record<string, string>) =>
      (await prisma.notification.create({ data: { userId, channel: 'in_app', templateCode, payloadJson, nextAttemptAt: FAR() }, select: { id: true } })).id;
    const due = await make('admin_acceptance_due', { order_number: 'BST-261029-AB12CD34-1', store_name: 'متجر العدد', hours: '9', link: '/admin/orders' });
    const stalled = await make('admin_return_stalled', { order_number: 'BST-261029-EF56GH78-1', store_name: 'متجر العدد', days: '11', link: '/admin/returns' });
    await sendOne(due);
    await sendOne(stalled);
    const bodyOf = async (id: string) => (await prisma.notification.findUniqueOrThrow({ where: { id }, select: { body: true } })).body ?? '';

    const dueBody = await bodyOf(due);
    expect(dueBody).toContain('9 ساعات');
    expect(dueBody).not.toContain('9 ساعة');
    const stalledBody = await bodyOf(stalled);
    expect(stalledBody).toContain('11 يوماً');
    expect(stalledBody).not.toContain('11 أيام');
    // ورقم الطلب كما هو
    expect(dueBody).toContain('BST-261029-AB12CD34-1');
  });
});
