/**
 * حارس ملف ZIP قبل أن يفكّه أحد — قنبلة الضغط.
 *
 * ExcelJS يفكّ كل ما في الملف إلى الذاكرة قبل أن نرى سطراً (JSZip)، وحدّ 5 م.ب
 * على الملف المضغوط لا على ما يصير إليه: 50 م.ب أصفاراً تُضغط إلى 50 ك.ب، فملف
 * بالحد المسموح ينتفخ إلى غيغابايتات ويُسقط الخادم. وأيّ مستخدم مسجّل يصير
 * بائعاً فوراً ويصل مسار الاستيراد.
 *
 * والأحجام المعلنة في فهرس الملف لا يُعتمد عليها — يكتبها المهاجم. فيُفكّ كل
 * مدخل هنا بـ zlib وسقفٍ على ما يُخرجه (maxOutputLength): يتوقّف الفكّ عند
 * السقف قبل أن يحجز ما بعده. ما يعبر هذا يفكّه ExcelJS بعدها بالأحجام نفسها.
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  /** مجموع ما تُفكّ إليه المداخل كلها */
  readonly maxTotalBytes: number;
  readonly maxEntries: number;
}

/** ملف xlsx بحدّ الأسطر (5000) لا يقترب من هذا — ورقة وسلاسل نصّية ببضعة م.ب */
export const XLSX_LIMITS: ZipLimits = { maxTotalBytes: 40 * 1024 * 1024, maxEntries: 200 };

export class ZipRejectedError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** يرمي ZipRejectedError برسالة للبائع إن كان الملف قنبلة أو تالفاً أو بصيغة لا نفكّها */
export function assertSafeZip(buf: Buffer, limits: ZipLimits = XLSX_LIMITS): void {
  // نهاية الفهرس في آخر 22 بايتاً + تعليق حتى 64 ك.ب
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipRejectedError('ملف Excel تالف: لا فهرس له.');

  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64 يعلن حقوله بأقصى قيمها — لا يحتاجه ملف بحجمنا، ويُستعمل لإخفاء الأحجام
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipRejectedError('صيغة ZIP64 غير مدعومة في ملف الاستيراد. احفظه من Excel من جديد.');
  }
  if (entries > limits.maxEntries) {
    throw new ZipRejectedError(`ملف Excel يحوي ${entries} مدخلاً — أكثر مما يحويه جدول منتجات.`);
  }
  if (cdOffset + cdSize > eocd) throw new ZipRejectedError('ملف Excel تالف: فهرسه خارج حدوده.');

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) {
      throw new ZipRejectedError('ملف Excel تالف: فهرسه مقطوع.');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new ZipRejectedError('ملف Excel مشفّر بكلمة مرور. احفظه بلا حماية.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL) {
      throw new ZipRejectedError('ملف Excel تالف: مدخل بلا ترويسة.');
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) throw new ZipRejectedError('ملف Excel تالف: مدخل مقطوع.');
    const data = buf.subarray(start, start + compressed);

    const remaining = limits.maxTotalBytes - total;
    if (method === 0) {
      total += compressed;
    } else if (method === 8) {
      try {
        // السقف على الخرج نفسه: ما تجاوزه يرمي قبل أن يُحجز
        total += inflateRawSync(data, { maxOutputLength: Math.max(1, remaining) }).length;
      } catch (err) {
        if (err instanceof RangeError) {
          throw new ZipRejectedError('ملف Excel ينتفخ عند فكّه أضعاف حجمه المعقول — يُرفض. صدّره من جديد أو استعمل CSV.');
        }
        throw new ZipRejectedError('ملف Excel تالف: تعذّر فكّ أحد مداخله.');
      }
    } else {
      throw new ZipRejectedError('ملف Excel بضغط غير معروف. احفظه من جديد بصيغة .xlsx.');
    }
    if (total > limits.maxTotalBytes) {
      throw new ZipRejectedError('ملف Excel ينتفخ عند فكّه أضعاف حجمه المعقول — يُرفض. صدّره من جديد أو استعمل CSV.');
    }
  }
}
