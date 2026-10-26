/**
 * انقطاع البريد لا يختم الإشعار «فشل» في ثوانٍ — SYS-031 على PostgreSQL حيّ وخادم SMTP حقيقي.
 *
 * ما يُثبَت: المحاولة الفاشلة تؤجَّل بمهلة تطول؛ المرسِل لا يعيدها قبل موعدها ولو عاد الخادم؛
 * حين يحين تصل؛ ولا يُختم «فشل» إلا بعد المحاولة الأخيرة.
 *
 * قاعدة التطوير مشتركة مع ملفات تعمل بالتوازي: صفوف الاختبار تُنشأ بموعد بعيد فلا يلتقطها
 * مرسِل غيرنا، وتُرسل هنا بـ sendOne مباشرة. والمرسِل العام لا يُستدعى والبريد معطّل —
 * كان سيُفشل بريد الملفات الأخرى ويؤجّله.
 */
import { PrismaClient } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { MAX_ATTEMPTS } from './domain/retry';
import { NotificationsService } from './public';

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma as unknown as PrismaService);
const sendOne = (id: string) => notifications['sendOne'](id);
const EMAIL = `outbox.retry${Date.now()}@basta.test`;
let smtp: SMTPServer;
let down = true;
let userId = '';
let dbUp = false;

const FAR = () => new Date(Date.now() + 24 * 3600_000);
async function row(attempts: number): Promise<string> {
  const r = await prisma.notification.create({
    data: {
      userId,
      channel: 'email',
      templateCode: 'password_reset_code',
      payloadJson: { name: 'من انقطع بريده', code: '482913', minutes: '10' },
      attempts,
      nextAttemptAt: FAR(),
    },
    select: { id: true },
  });
  return r.id;
}
const get = (id: string) =>
  prisma.notification.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, error: true, nextAttemptAt: true, deliveryRef: true } });
/** ثوانٍ من الآن حتى موعد المحاولة التالية */
const waitOf = (at: Date | null) => Math.round(((at?.getTime() ?? 0) - Date.now()) / 1000);

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  smtp = new SMTPServer({
    disabledCommands: ['STARTTLS'],
    authOptional: true,
    logger: false,
    onConnect(_session, callback) {
      callback(down ? new Error('خادم البريد معطّل') : undefined);
    },
    onData(stream, _session, callback) {
      stream.resume();
      stream.on('end', () => callback());
    },
  });
  await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
  process.env['SMTP_URL'] = `smtp://127.0.0.1:${(smtp.server.address() as AddressInfo).port}`;
  userId = (await prisma.user.create({ data: { email: EMAIL, fullName: 'من انقطع بريده' }, select: { id: true } })).id;
});

afterAll(async () => {
  delete process.env['SMTP_URL'];
  if (userId) {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  if (smtp) await new Promise<void>((ok) => smtp.close(() => ok()));
  await prisma.$disconnect();
});

describe('انقطاع البريد: إعادة بمهلة تطول (SYS-031)', () => {
  it('الفاشل يُؤجَّل 10 ثوانٍ ثم 30، ولا يُعاد قبل موعده ولو عاد الخادم، ويصل حين يحين', async () => {
    if (!dbUp) return;
    const id = await row(0);
    down = true;

    await sendOne(id);
    let r = await get(id);
    expect(r).toMatchObject({ status: 'queued', attempts: 1 });
    expect(r.error).toBeTruthy();
    expect(waitOf(r.nextAttemptAt)).toBeGreaterThanOrEqual(9);
    expect(waitOf(r.nextAttemptAt)).toBeLessThanOrEqual(10);

    await sendOne(id);
    r = await get(id);
    expect(r).toMatchObject({ status: 'queued', attempts: 2 });
    expect(waitOf(r.nextAttemptAt)).toBeGreaterThanOrEqual(29);
    expect(waitOf(r.nextAttemptAt)).toBeLessThanOrEqual(30);

    // عاد الخادم ولم يحن الموعد: المرسِل يتجاوزه — كان يعيده كل 5 ثوانٍ حتى الخامسة
    down = false;
    await notifications.dispatch(500);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 2 });

    // حان الموعد: يصل (بمرسِلنا أو بمرسِل ملف آخر — المهم أنه أُرسل بمحاولته الثالثة)
    await prisma.notification.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await notifications.dispatch(500);
    r = await get(id);
    expect(r).toMatchObject({ status: 'sent', attempts: 3 });
  }, 60_000);

  it('السابعة إن فشلت تُعاد بعد ساعة، والثامنة إن فشلت تُختم «فشل»', async () => {
    if (!dbUp) return;
    down = true;

    const seventh = await row(MAX_ATTEMPTS - 2);
    await sendOne(seventh);
    const r7 = await get(seventh);
    expect(r7).toMatchObject({ status: 'queued', attempts: 7 });
    expect(waitOf(r7.nextAttemptAt)).toBeGreaterThanOrEqual(3599);
    expect(waitOf(r7.nextAttemptAt)).toBeLessThanOrEqual(3600);

    const last = await row(MAX_ATTEMPTS - 1);
    await sendOne(last);
    const r8 = await get(last);
    expect(r8).toMatchObject({ status: 'failed', attempts: 8 });
    expect(r8.error).toBeTruthy();
  }, 60_000);
});
