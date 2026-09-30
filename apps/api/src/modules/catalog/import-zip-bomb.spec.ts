/**
 * قنبلة الضغط في ملف الاستيراد — تُرفض قبل أن يفكّها ExcelJS إلى الذاكرة.
 *
 * ما يُثبَت:
 *   · ملف xlsx حقيقي بحدّ الأسطر كله (5000) يعبر الحارس — السقف لا يخنق الاستعمال
 *   · مدخل ينتفخ إلى 200 م.ب من أقل من 1 م.ب مضغوطاً يُرفض برسالة للبائع
 *   · والأحجام المعلنة في الفهرس لا تخدعه: قنبلة تعلن أحجاماً صغيرة تُرفض أيضاً
 *   · كثرة المداخل، والتشفير، والملف المقطوع، و ZIP64 — كلها تُرفض لا تُسقط الخادم
 */
import * as ExcelJS from 'exceljs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ImportFileRejectedError } from './domain/import-plan';
import { readImportFile } from './infrastructure/import-file-reader';
import { assertSafeZip, ZipRejectedError } from './infrastructure/zip-guard';

interface Entry {
  readonly name: string;
  readonly data: Buffer;
  /** يكتب في الفهرس حجماً غير الحقيقي — كما يفعل مهاجم */
  readonly lieUncompressed?: number;
  readonly flags?: number;
}

/** كاتب ZIP أدنى: ترويسة محلية لكل مدخل، ثم الفهرس، ثم نهايته — بضغط deflate */
function zip(entries: readonly Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const packed = deflateRawSync(e.data);
    const size = e.lieUncompressed ?? e.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const MB = 1024 * 1024;
const zeros = (n: number) => Buffer.alloc(n, 0x30);

describe('قنبلة الضغط في ملف الاستيراد', () => {
  it('ملف xlsx حقيقي بحدّ الأسطر كله يعبر الحارس ويُقرأ', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('منتجات');
    ws.addRow(['sku', 'name_ar', 'description_ar', 'price', 'stock', 'category', 'brand', 'color', 'size', 'weight_g']);
    for (let i = 0; i < 5000; i++) {
      ws.addRow([`SKU-${i}`, `منتج تجريبي رقم ${i}`, 'وصف قصير للمنتج بالعربية يكفي لعرضه', 12.5 + i, 10, 'home', 'بسطة', 'أحمر', 'M', 500]);
    }
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() => assertSafeZip(file)).not.toThrow();
    const sheet = await readImportFile(file);
    expect(sheet.format).toBe('xlsx');
    expect(sheet.rows).toHaveLength(5000);
  }, 60_000);

  it('مدخل ينتفخ إلى 200 م.ب من أقل من 1 م.ب يُرفض قبل ExcelJS برسالة للبائع', async () => {
    const bomb = zip([{ name: 'xl/worksheets/sheet1.xml', data: zeros(200 * MB) }]);
    expect(bomb.length).toBeLessThan(MB);
    const heapBefore = process.memoryUsage().heapUsed;
    await expect(readImportFile(bomb)).rejects.toThrow(ImportFileRejectedError);
    await expect(readImportFile(bomb)).rejects.toThrow(/ينتفخ/);
    // الفكّ توقّف عند السقف: لم يُحجز ما يقارب 200 م.ب في الكومة
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(100 * MB);
  });

  it('الأحجام المعلنة لا تخدعه: قنبلة تعلن 100 بايت لكل مدخل تُرفض', () => {
    const liar = zip([
      { name: '[Content_Types].xml', data: zeros(1_000) },
      { name: 'xl/sharedStrings.xml', data: zeros(30 * MB), lieUncompressed: 100 },
      { name: 'xl/worksheets/sheet1.xml', data: zeros(30 * MB), lieUncompressed: 100 },
    ]);
    expect(() => assertSafeZip(liar)).toThrow(/ينتفخ/);
  });

  it('مداخل كثيرة، ومشفّر، ومقطوع، و ZIP64 — تُرفض ولا تُسقط شيئاً', () => {
    const many = zip(Array.from({ length: 250 }, (_, i) => ({ name: `x/${i}.xml`, data: Buffer.from('<a/>') })));
    expect(() => assertSafeZip(many)).toThrow(ZipRejectedError);

    const encrypted = zip([{ name: 'xl/workbook.xml', data: Buffer.from('<a/>'), flags: 0x1 }]);
    expect(() => assertSafeZip(encrypted)).toThrow(/مشفّر/);

    const whole = zip([{ name: 'xl/workbook.xml', data: zeros(10_000) }]);
    expect(() => assertSafeZip(whole.subarray(0, whole.length - 10))).toThrow(ZipRejectedError);

    const zip64 = Buffer.from(whole);
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
    expect(() => assertSafeZip(zip64)).toThrow(/ZIP64/);
  });
});
