/**
 * البريد يصل فعلاً: خادم SMTP حقيقي على الجهاز يستقبل ما يرسله المحوّل.
 *
 * كان كل بريد يُكتب ملفاً في صندوق محلي — على استضافة مجانية قرصها يُمسح، فرمز
 * استعادة كلمة المرور لا يصل أحداً. ما يُثبَت:
 *   · بـ SMTP_URL يصل البريد: المستلم والموضوع والنص العربي ونسخة HTML باتجاه عربي
 *   · المستخدم وكلمة المرور من العنوان يصلان الخادم مفكوكين (‎%40 ← @)
 *   · رفض الخادم يُرمى — فيعيده الصندوق الصادر بدل أن يُختم «أُرسل»
 *   · بلا SMTP_URL يبقى الصندوق المحلي كما كان
 */
import { simpleParser } from 'mailparser';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { SMTPServer, type SMTPServerAuthentication, type SMTPServerOptions } from 'smtp-server';
import { afterEach, describe, expect, it } from 'vitest';
import { deliver } from './channels';

let server: SMTPServer | null = null;
const received: { rcpt: string[]; raw: Buffer }[] = [];
const auths: SMTPServerAuthentication[] = [];

async function startSmtp(options: Partial<SMTPServerOptions> = {}): Promise<number> {
  received.length = 0;
  auths.length = 0;
  server = new SMTPServer({
    disabledCommands: ['STARTTLS'],
    authOptional: true,
    allowInsecureAuth: true,
    logger: false,
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        received.push({ rcpt: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks) });
        done();
      });
    },
    ...options,
  });
  await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
  return (server.server.address() as AddressInfo).port;
}

afterEach(async () => {
  delete process.env['SMTP_URL'];
  if (server) await new Promise<void>((ok) => server!.close(() => ok()));
  server = null;
});

const recovery = (id: string) => ({
  id,
  channel: 'email' as const,
  recipient: 'buyer@example.test',
  subject: 'رمز استعادة كلمة المرور',
  body: 'رمزك 482913\nصالح خمس عشرة دقيقة.',
});

describe('البريد عبر SMTP', () => {
  it('يصل البريد كما كُتب: المستلم والموضوع والنص العربي، ونسخة HTML باتجاه عربي', async () => {
    const port = await startSmtp();
    process.env['SMTP_URL'] = `smtp://127.0.0.1:${port}`;
    const id = '0b7e3f6a-6d1e-4c2a-9f31-2b8c5d7e9a10';

    const ref = await deliver(recovery(id));

    expect(ref).toBe(`smtp:<${id}@basta.local>`);
    expect(received).toHaveLength(1);
    expect(received[0]!.rcpt).toEqual(['buyer@example.test']);
    const mail = await simpleParser(received[0]!.raw);
    expect(mail.subject).toBe('رمز استعادة كلمة المرور');
    expect(mail.text?.trim()).toBe('رمزك 482913\nصالح خمس عشرة دقيقة.');
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('رمزك 482913<br>');
    expect(mail.messageId).toBe(`<${id}@basta.local>`);
    expect(mail.headers.get('content-language')).toBe('ar');
  });

  it('المستخدم وكلمة المرور من العنوان يصلان الخادم مفكوكين', async () => {
    const port = await startSmtp({
      authOptional: false,
      onAuth(auth, _session, done) {
        auths.push(auth);
        done(null, { user: auth.username });
      },
    });
    process.env['SMTP_URL'] = `smtp://seller%40example.test:p%3Ass%40word@127.0.0.1:${port}`;

    await deliver(recovery('1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'));

    expect(auths).toHaveLength(1);
    expect(auths[0]!.username).toBe('seller@example.test');
    expect(auths[0]!.password).toBe('p:ss@word');
    expect(received).toHaveLength(1);
  });

  it('رفض الخادم يُرمى — فيعيد الصندوق الصادر المحاولة بدل أن يختمها «أُرسل»', async () => {
    const port = await startSmtp({
      onRcptTo(_address, _session, done) {
        done(Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }));
      },
    });
    process.env['SMTP_URL'] = `smtp://127.0.0.1:${port}`;

    await expect(deliver(recovery('2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60'))).rejects.toThrow(/550|mailbox unavailable/);
    expect(received).toHaveLength(0);
  });

  it('بلا SMTP_URL يبقى الصندوق المحلي: ملف .eml بالنص نفسه', async () => {
    const id = '3e4f5a6b-7c8d-4e9f-0a1b-2c3d4e5f6071';
    const ref = await deliver(recovery(id));
    expect(ref).toMatch(new RegExp(`${id}\\.eml$`));
    const mail = await simpleParser(await readFile(ref));
    expect(mail.subject).toBe('رمز استعادة كلمة المرور');
    expect(mail.text?.trim()).toBe('رمزك 482913\nصالح خمس عشرة دقيقة.');
  });
});
