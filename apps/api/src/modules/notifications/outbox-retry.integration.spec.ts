/**
 * انقطاع البريد لا يختم الإشعار «فشل» في ثوانٍ — SYS-031 على PostgreSQL حيّ وخادم SMTP حقيقي.
 *
 * ما يُثبَت: المحاولة الفاشلة تؤجَّل بمهلة تطول؛ المرسِل لا يعيدها قبل موعدها ولو عاد الخادم؛
 * حين يحين تصل؛ ولا يُختم «فشل» إلا بعد المحاولة الأخيرة. وما سقط مرسِله أثناء إرساله (SYS-034)
 * يُعاد بعد مهلة الحجز لا قبلها، ولا يُعاد بلا حدّ.
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
import { MAX_ATTEMPTS, SENDING_LEASE_SECONDS } from './domain/retry';
import { NotificationsService } from './public';

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma as unknown as PrismaService);
const sendOne = (id: string) => notifications['sendOne'](id);
const EMAIL = `outbox.retry${Date.now()}@basta.test`;
let smtp: SMTPServer;
let down = true;
/** يقبل الرسالة ثم يتأخّر بالردّ — كمزوّد بطيء، ليُرى الإشعار وهو «يُرسل» */
let slowMs = 0;
let userId = '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
      stream.on('end', () => setTimeout(() => callback(), slowMs));
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

describe('سقوط المرسِل أثناء الإرسال (SYS-034)', () => {
  /** كما يتركه خادم سقط بعد الحجز وقبل الختام: «يُرسل» ومهلة حجزه تنتهي عند `until` */
  async function stuck(attempts: number, until: Date): Promise<string> {
    const id = await row(attempts);
    await prisma.notification.update({ where: { id }, data: { status: 'sending', nextAttemptAt: until } });
    return id;
  }
  /** يرسله مرسِلنا أو مرسِل ملف آخر بعد انقضاء المهلة — ننتظر حتى يُختم */
  async function settled(id: string) {
    for (let i = 0; i < 50; i++) {
      const r = await get(id);
      if (r.status !== 'sending') return r;
      await sleep(100);
    }
    return get(id);
  }

  it('الحجز بمهلة دقيقتين ما دام يُرسل، والختام يمحوها', async () => {
    if (!dbUp) return;
    down = false;
    slowMs = 1500;
    const id = await row(0);
    const sending = sendOne(id);
    await sleep(700);
    const during = await get(id);
    expect(during).toMatchObject({ status: 'sending', attempts: 1 });
    expect(waitOf(during.nextAttemptAt)).toBeGreaterThanOrEqual(SENDING_LEASE_SECONDS - 2);
    expect(waitOf(during.nextAttemptAt)).toBeLessThanOrEqual(SENDING_LEASE_SECONDS);
    await sending;
    slowMs = 0;
    expect(await get(id)).toMatchObject({ status: 'sent', attempts: 1, nextAttemptAt: null });
  }, 60_000);

  it('عالق «يُرسل»: لا يُلتقط قبل انقضاء مهلته — مرسِله قد يكون حيّاً — وبعدها يُعاد ويصل', async () => {
    if (!dbUp) return;
    down = false;
    const id = await stuck(1, new Date(Date.now() + SENDING_LEASE_SECONDS * 1000));
    expect(await sendOne(id)).toBeNull();
    await notifications.dispatch(500);
    expect(await get(id)).toMatchObject({ status: 'sending', attempts: 1 });

    // انقضت المهلة ولم يُختم: سقط مرسِله. كان يبقى «يُرسل» إلى الأبد — dispatch يلتقط queued وحده
    await prisma.notification.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await notifications.dispatch(500);
    expect(await settled(id)).toMatchObject({ status: 'sent', attempts: 2, nextAttemptAt: null });
  }, 60_000);

  it('سقط أثناء المحاولة الأخيرة: يُختم «فشل» ولا يُعاد بلا حدّ', async () => {
    if (!dbUp) return;
    down = false;
    const id = await stuck(MAX_ATTEMPTS, new Date(Date.now() - 1000));
    await sendOne(id);
    const r = await settled(id);
    expect(r).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS + 1 });
    expect(r.error).toMatch(/سقط الخادم/);
  }, 60_000);
});
