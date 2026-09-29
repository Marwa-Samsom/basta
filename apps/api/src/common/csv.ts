/**
 * خانة CSV آمنة — مقتبسة، ولا تُقرأ معادلة.
 *
 * Excel و LibreOffice ينفّذان الخانة التي تبدأ بـ = أو + أو - أو @ (أو تاب أو رجوع
 * سطر قبلها) معادلةً: اسم منتج يكتبه بائع «=HYPERLINK("https://evil…","اضغط")»
 * يصير في تقريره أو تقرير الإدارة رابطاً يسرّب أو أمراً يُنفَّذ عند من يفتح الملف.
 * يُسبق النصّ بـ ' فيُقرأ نصّاً كما كُتب (OWASP: CSV Injection).
 *
 * الرقم الخالص يبقى كما هو — المبالغ المدينة «-2500» أرقام تُجمع في Excel لا نصوص.
 * نسخة الواجهة: apps/web/src/lib/csv.ts — القاعدة نفسها.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
