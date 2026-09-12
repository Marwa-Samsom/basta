/**
 * سجل الأخطاء الدائم — المكافئ المحلي لخدمة تنبيه خارجية.
 *
 * الهدف في بوابة المرحلة 03 ليس «استعمال Sentry»، بل **ألّا يمرّ خطأ صامتاً**.
 * بلا استضافة ولا حساب، يتحقّق الهدف نفسه بملف JSONL دائم: كل خطأ غير
 * متوقّع يُكتب سطراً مستقلاً بمعرّف الطلب، فيُربط بلاغ المستخدم بالسبب
 * بعد ساعات أو أيام — وهو ما يفعله التنبيه الخارجي أصلاً.
 *
 * الصيغة JSONL لا نص حرّ: قابلة للاستعلام بـ jq أو بسطر node واحد، وقابلة
 * للشحن إلى Sentry أو Loki لاحقاً بلا إعادة كتابة.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const LOG_PATH = resolve(process.env['ERROR_LOG_PATH'] ?? 'logs/errors.jsonl');

export interface ErrorRecord {
  timestamp: string;
  requestId: string;
  level: 'error' | 'fatal';
  domain?: string;
  message: string;
  stack?: string;
  method?: string;
  url?: string;
}

/**
 * الحقول التي لا تُكتب أبداً — نفس قائمة تصفية Sentry.
 *
 * النمط يحتمل صيغتين: الاقتباس العادي `"password"` والمهرَّب `\"password\"`.
 * السبب أن سرّاً يظهر داخل نص رسالة خطأ يُهرَّب مرتين عند التسلسل، فنمط
 * يطابق الصيغة الأولى وحدها يمرّر السرّ إلى الملف وهو يظنّ أنه نقّاه.
 */
const REDACTED =
  /(\\?"(?:password|passwordHash|cardNumber|cvv|totpSecret|totpSecretEnc|iban|authorization|cookie)\\?"\s*:\s*)(\\?")(?:(?!\2).)*\2/gi;

function redact(text: string): string {
  return text.replace(REDACTED, (_m, key: string, quote: string) => `${key}${quote}[محذوف]${quote}`);
}

/**
 * الكتابة متزامنة عمداً: الخطأ قد يسبق انهيار العملية مباشرة، والكتابة
 * غير المتزامنة تضيع في تلك اللحظة بالذات — وهي اللحظة التي يلزم فيها السطر.
 */
export function writeErrorLog(record: ErrorRecord): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, redact(JSON.stringify(record)) + '\n', 'utf8');
  } catch {
    // فشل الكتابة لا يُسقط الطلب: فقدُ سطر تشخيصي أهون من إسقاط عملية شراء
  }
}

export const errorLogPath = (): string => LOG_PATH;
