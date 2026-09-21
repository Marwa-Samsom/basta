import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Channel } from '../domain/templates';

/**
 * القنوات — محوّلات خلف واجهة واحدة كبوابة الدفع (ADR-012).
 *
 * المشروع محلي بلا مزوّدين مدفوعين: كل قناة تُسلِّم إلى **صندوق بريد محلي**
 * حقيقي — البريد ملف .eml بصيغة MIME يفتحه أي برنامج بريد، والنصية وواتساب
 * والمتصفّح ملفات JSON بما كان سيُرسل للمزوّد حرفياً. استبدال المحوّل بمزوّد
 * حقيقي (SMTP، أو مزوّد رسائل) لا يمسّ القوالب ولا الصندوق الصادر.
 */
export const OUTBOX_ROOT = resolve(process.cwd(), process.env['OUTBOX_DIR'] ?? 'outbox');

export interface Delivery {
  readonly id: string;
  readonly channel: Channel;
  readonly recipient: string;
  readonly subject: string | null;
  readonly body: string;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function eml(d: Delivery): string {
  const from = process.env['MAIL_FROM'] ?? 'Basta <no-reply@basta.local>';
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

/** يسلّم ويعيد مرجع التسليم (مسار الملف) */
export async function deliver(d: Delivery): Promise<string> {
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
