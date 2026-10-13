import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import type { Channel } from '../domain/templates';

/**
 * القنوات — محوّلات خلف واجهة واحدة كبوابة الدفع (ADR-012).
 *
 * **البريد** يُرسل عبر SMTP حين يُضبط `SMTP_URL` — أي مزوّد (Brevo، Gmail بكلمة
 * مرور تطبيق، …) بمُرسِل موثَّق ولا يلزمه دومين. بدونه، وفي التطوير والاختبار،
 * يُسلَّم إلى **صندوق بريد محلي**: ملف .eml بصيغة MIME يفتحه أي برنامج بريد.
 * النصية وواتساب والمتصفّح بلا مزوّد بعد: ملفات JSON بما كان سيُرسل حرفياً.
 * استبدال المحوّل لا يمسّ القوالب ولا الصندوق الصادر.
 */
export const OUTBOX_ROOT = resolve(process.cwd(), process.env['OUTBOX_DIR'] ?? 'outbox');

const mailFrom = () => process.env['MAIL_FROM'] ?? 'Basta <no-reply@basta.local>';

/** نطاق المُرسِل لمعرّف الرسالة — `<id@نطاق>` كما تتوقّعه خوادم البريد */
const fromDomain = () => /@([^>\s]+)/.exec(mailFrom())?.[1] ?? 'basta.local';

/**
 * ناقل SMTP من `SMTP_URL`: `smtps://مستخدم:كلمة@مضيف:465` (TLS من البداية) أو
 * `smtp://…:587` (STARTTLS إلزامي إلا على الجهاز نفسه — كلمة مرور لا تعبر الشبكة
 * نصاً). المهل قصيرة: مزوّد معطّل يُفشل المحاولة فيعيدها الصندوق الصادر، لا يحبسه
 * دقيقتين. يُبنى مرة لكل عنوان.
 */
let cached: { url: string; transport: Transporter } | null = null;
function smtp(): Transporter | null {
  const url = process.env['SMTP_URL'];
  if (!url) return null;
  if (cached?.url === url) return cached.transport;
  const u = new URL(url);
  const secure = u.protocol === 'smtps:';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  const transport = createTransport({
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: Number(u.port) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure && !local,
    ...(u.username ? { auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cached = { url, transport };
  return transport;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** نسخة HTML من النص نفسه باتجاه عربي — برامج البريد تعرض النص المجرّد يساراً */
const rtlHtml = (text: string) =>
  `<div dir="rtl" lang="ar" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;text-align:right">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;

export interface Delivery {
  readonly id: string;
  readonly channel: Channel;
  readonly recipient: string;
  readonly subject: string | null;
  readonly body: string;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function eml(d: Delivery): string {
  const from = mailFrom();
  const body = b64(d.body).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${from}`,
    `To: ${d.recipient}`,
    `Subject: =?UTF-8?B?${b64(d.subject ?? '')}?=`,
    `Message-ID: <${d.id}@basta.local>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Content-Language: ar',
    '',
    body,
  ].join('\r\n');
}

/**
 * يسلّم ويعيد مرجع التسليم: `smtp:<معرّف الرسالة>` لما قبله خادم البريد، أو مسار
 * الملف في الصندوق المحلي. رفض الخادم أو تعذّر الاتصال يُرمى، فيعيده الصندوق الصادر.
 */
export async function deliver(d: Delivery): Promise<string> {
  const transport = d.channel === 'email' ? smtp() : null;
  if (transport) {
    const info = await transport.sendMail({
      from: mailFrom(),
      to: d.recipient,
      subject: d.subject ?? '',
      text: d.body,
      html: rtlHtml(d.body),
      messageId: `<${d.id}@${fromDomain()}>`,
      headers: { 'Content-Language': 'ar' },
    });
    return `smtp:${info.messageId}`;
  }

  const dir = join(OUTBOX_ROOT, d.channel);
  await mkdir(dir, { recursive: true });
  if (d.channel === 'email') {
    const path = join(dir, `${d.id}.eml`);
    await writeFile(path, eml(d), 'utf8');
    return path;
  }
  const path = join(dir, `${d.id}.json`);
  await writeFile(
    path,
    JSON.stringify({ id: d.id, to: d.recipient, ...(d.subject ? { title: d.subject } : {}), text: d.body, at: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return path;
}
