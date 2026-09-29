/**
 * خانة CSV آمنة — مقتبسة، ولا تُقرأ معادلة. ما يبدأ بـ = أو + أو - أو @ (أو تاب
 * أو رجوع سطر) يُسبق بـ ' فيفتحه Excel نصّاً لا معادلة؛ والرقم الخالص يبقى رقماً.
 * نسخة الخادم: apps/api/src/common/csv.ts — القاعدة نفسها.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: string): string {
  const s = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return `"${s.replace(/"/g, '""')}"`;
}
