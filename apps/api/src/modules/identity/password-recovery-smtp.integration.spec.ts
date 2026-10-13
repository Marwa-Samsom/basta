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
let dispatch: (limit: number) => Promise<unknown>;

const SUFFIX = `rcv${Date.now()}`;
const EMAIL = `forgot.${SUFFIX}@basta.test`;
const OLD = 'كلمة-مرور-قديمة-طويلة';
const NEW = 'كلمة-مرور-جديدة-أطول';

const call = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1${url}`, payload });

/** يرسل الصندوق الصادر حتى يخرج بريد هذا المستخدم — المرسِل الدوري قد يكون في دورة */
async function drain(userId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await dispatch(500);
    const left = await prisma.notification.count({ where: { userId, status: { in: ['queued', 'sending'] } } });
    if (left === 0) return;
    await new Promise((r) => setTimeout(r, 100));
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
  dispatch = (limit) => notifications.dispatch(limit);
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

    expect((await call('/auth/password/forgot', { email: EMAIL })).statusCode).toBe(200);
    await drain(userId);

    // وصل البريد الخادم — الموضوع والرمز فيه، ومختوم «أُرسل» بمرجع SMTP لا بملف
    const delivered = inbox.filter((m) => m.to.includes(EMAIL));
    const mails = await Promise.all(delivered.map((m) => simpleParser(m.raw)));
    const reset = mails.find((m) => /\b\d{6}\b/.test(m.text ?? '') && /كلمة المرور/.test(`${m.subject} ${m.text}`));
    expect(reset, mails.map((m) => m.subject).join(' | ')).toBeDefined();
    const code = /\b(\d{6})\b/.exec(reset!.text!)![1]!;
    const row = await prisma.notification.findFirstOrThrow({ where: { userId, templateCode: 'password_reset_code', channel: 'email' } });
    expect(row.status).toBe('sent');
    expect(row.deliveryRef).toMatch(/^smtp:<.+>$/);

    // الرمز من البريد يعيّن الكلمة الجديدة
    const res = await call('/auth/password/reset', { email: EMAIL, code, newPassword: NEW });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call('/auth/login', { email: EMAIL, password: NEW })).statusCode).toBe(200);
    expect((await call('/auth/login', { email: EMAIL, password: OLD })).statusCode).toBe(401);
  }, 60_000);
});
