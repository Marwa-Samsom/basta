/**
 * صفحات القوائم الإدارية — كل قائمة تكبر مع الوقت تُقرأ خمسين خمسين بـ ?page=N ومعها
 * إجماليها، فتُلحق اللوحة الصفحة التالية بزرّ «المزيد». كانت هذه القوائم تقف عند أول
 * مئة أو مئتين بلا بحث ولا ما بعدها، فما بعدها لا يُوصل إليه (J-11، 20 أكتوبر 2026).
 */
export const ADMIN_PAGE = 50;

/** رقم الصفحة من الاستعلام كما وصل — الأولى إن غاب أو لم يكن عدداً موجباً */
export function pageOf(raw?: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** skip و take لصفحة بعينها */
export function pageArgs(page: number, size = ADMIN_PAGE): { skip: number; take: number } {
  return { skip: (Math.max(1, page) - 1) * size, take: size };
}

/** عبارة البحث منظّفة، أو undefined إن كانت فارغة — والطول محدود فلا يصل Prisma نصّ طويل */
export function termOf(raw?: string): string | undefined {
  const t = raw?.trim().slice(0, 100);
  return t ? t : undefined;
}

/** «يحتوي» بلا حساسية لحالة الأحرف — شرط البحث في كل حقل نصّي */
export const like = (t: string) => ({ contains: t, mode: 'insensitive' as const });
