import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * كل عمود تُقيَّد به فترة في تقارير الإدارة ولوحتها (reports.service) له فهرس يبدأ
 * به — وإلا مسح كل تقرير الجدول كاملاً. حارس بنيوي من القاعدة نفسها: عمود فترة
 * جديد في تقرير يُضاف هنا مع فهرسه، أو يسقط الاختبار.
 */
const RANGE_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ['orders', 'paidAt'],
  ['refunds', 'createdAt'],
  ['ledger_entries', 'createdAt'],
  ['platform_ledger_entries', 'createdAt'],
  ['payout_requests', 'paidAt'],
  ['sub_orders', 'placedAt'],
  ['carts', 'createdAt'],
];

/** طابور اللوحة: فهرس جزئي بشرط الطابور نفسه (طابور المنتجات سقط مع مراجعتها — 15 أكتوبر 2026) */
const QUEUES: readonly (readonly [index: string, predicate: RegExp])[] = [
  ['sub_orders_awaiting_vendor_idx', /awaiting_vendor/],
];

const prisma = new PrismaClient();
let dbUp = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — حارس فهارس التقارير متخطّى.\n');
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('فهارس فترات التقارير', () => {
  it('كل عمود فترة له فهرس يبدأ به', async () => {
    if (!dbUp) return;
    const leading = await prisma.$queryRaw<{ table: string; column: string }[]>`
      SELECT t.relname AS "table", a.attname AS "column"
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
      WHERE t.relnamespace = 'public'::regnamespace`;
    const have = new Set(leading.map((l) => `${l.table}.${l.column}`));
    const missing = RANGE_COLUMNS.filter(([t, c]) => !have.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);
    expect(missing, 'أعمدة فترة بلا فهرس يبدأ بها').toEqual([]);
  });

  it('طابورا اللوحة لهما فهرسان جزئيان بشرطهما', async () => {
    if (!dbUp) return;
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    for (const [name, predicate] of QUEUES) {
      const def = rows.find((r) => r.indexname === name)?.indexdef ?? '';
      expect(def, name).toMatch(predicate);
    }
  });
});
