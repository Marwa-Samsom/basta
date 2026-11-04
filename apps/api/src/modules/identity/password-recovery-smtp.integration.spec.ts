/**
 * استعادة كلمة المرور تعمل من أولها إلى آخرها بالبريد الحقيقي.
 *
 * كان رمز الاستعادة يُكتب ملفاً على قرص الخادم — على استضافة مجانية قرصها يُمسح —
 * فمن نسي كلمة مروره لا يعود إلى حسابه، ولا أداة إدارية تعوّض. هنا خادم SMTP حقيقي
 * على الجهاز مكان المزوّد: «نسيت كلمة المرور» ← الرمز في البريد الذي وصل ← كلمة
 * جديدة ← دخول بها، والقديمة لا تفتح.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { simpleParser } from 'mailparser';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let smtp: SMTPServer;
let dbUp = false;
const inbox: { to: string[]; raw: Buffer }[] = [];
let dispatch: (limit: number, userId: string) => Promise<unknown>;

const SUFFIX = `rcv${Date.now()}`;
const EMAIL = `forgot.${SUFFIX}@basta.test`;
const OLD = 'كلمة-مرور-قديمة-طويلة';
const NEW = 'كلمة-مرور-جديدة-أطول';

const call = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1${url}`, payload });

/**
 * «نسيت كلمة المرور» حتى يخرج الرمز **عبر SMTP هذا الاختبار**. ملفات الاختبار
 * الأخرى تعمل معاً على القاعدة نفسها، ومرسِل أيٍّ منها يلتقط أي إشعار ينتظر —
 * فيكتبه ملفاً لأن SMTP_URL ليس في عمليته. والرمز يُمحى من الإشعار بعد أول تسليم
 * (لا يبقى في السجل)، فما التقطه غيرنا لا يُعاد: يُطلب رمز جديد كما يفعل المستخدم.
 */
async function forgotThroughSmtp(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // رمز جديد لا يُصدر قبل دقيقة من سابقه — المحاولة الثانية تقدّم عمر السابق بدل الانتظار
    if (attempt > 0) {
      await prisma.otpCode.updateMany({ where: { userId, purpose: 'reset' }, data: { createdAt: new Date(Date.now() - 61_000) } });
    }
    const started = new Date();
    expect((await call('/auth/password/forgot', { email: EMAIL })).statusCode).toBe(200);
    for (let i = 0; i < 30; i++) {
      // رسائل هذا المستخدم وحدها: الأقدم أولاً من الصندوق كله كان يرسل قبلها مئات من الملفات الأخرى
      // عبر خادمنا، فتنقضي الدقيقة مع الحزمة كلها (تسع ثوانٍ وحده — 4 نوفمبر 2026)
      await dispatch(50, userId);
      const row = await prisma.notification.findFirst({
        where: { userId, templateCode: 'password_reset_code', channel: 'email', createdAt: { gte: started } },
        orderBy: { createdAt: 'desc' },
        select: { status: true, deliveryRef: true },
      });
      if (row?.status === 'sent' && row.deliveryRef?.startsWith('smtp:')) return;
      if (row?.status === 'sent' || row?.status === 'failed') break; // سلّمه غيرنا — رمز جديد
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

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
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks) });
        done();
      });
    },
  });
  await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
  process.env['SMTP_URL'] = `smtp://127.0.0.1:${(smtp.server.address() as AddressInfo).port}`;

  const [{ Test }, { AppModule }, { configureApp }, { NotificationsService }] = await Promise.all([
    import('@nestjs/testing'),
    import('../../app.module'),
    import('../../app.setup'),
    import('../notifications/public'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const notifications = app.get(NotificationsService);
  dispatch = (limit, userId) => notifications.dispatch(limit, { userIds: [userId] });
}, 90_000);

afterAll(async () => {
  delete process.env['SMTP_URL'];
  await app?.close();
  if (smtp) await new Promise<void>((ok) => smtp.close(() => ok()));
  await prisma.$disconnect();
});

describe('استعادة كلمة المرور بالبريد الحقيقي (SMTP)', () => {
  it('الرمز يصل البريد، ويعيّن كلمة جديدة يُدخل بها — والقديمة لا تفتح', async () => {
    if (!dbUp) return;
    expect((await call('/auth/register', { email: EMAIL, password: OLD, fullName: 'من نسي كلمته' })).statusCode).toBe(201);
    const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });

    await forgotThroughSmtp(userId);

    // وصل البريد الخادم — الموضوع والرمز فيه، ومختوم «أُرسل» بمرجع SMTP لا بملف.
    // آخر بريد استعادة وصله هو رمزه الساري (طلب جديد يُبطل ما قبله)
    const delivered = inbox.filter((m) => m.to.includes(EMAIL));
    const mails = await Promise.all(delivered.map((m) => simpleParser(m.raw)));
    const reset = mails.filter((m) => /\d{6}/.test(m.text ?? '') && /كلمة المرور/.test(`${m.subject} ${m.text}`)).at(-1);
    expect(reset, mails.map((m) => m.subject).join(' | ')).toBeDefined();
    const code = /(\d{6})/.exec(reset!.text!)![1]!;
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId, templateCode: 'password_reset_code', channel: 'email' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.status).toBe('sent');
    expect(row.deliveryRef).toMatch(/^smtp:<.+>$/);

    // الرمز من البريد يعيّن الكلمة الجديدة
    const res = await call('/auth/password/reset', { email: EMAIL, code, newPassword: NEW });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call('/auth/login', { email: EMAIL, password: NEW })).statusCode).toBe(200);
    expect((await call('/auth/login', { email: EMAIL, password: OLD })).statusCode).toBe(401);
  }, 60_000);
});
