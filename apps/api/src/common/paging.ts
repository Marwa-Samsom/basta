/**
 * صفحات القوائم الإدارية — كل قائمة تكبر مع الوقت تُقرأ خمسين خمسين بـ ?page=N ومعها
 * إجماليها، فتُلحق اللوحة الصفحة التالية بزرّ «المزيد». كانت هذه القوائم تقف عند أول
 * مئة أو مئتين بلا بحث ولا ما بعدها، فما بعدها لا يُوصل إليه (J-11، 20 أكتوبر 2026).
 */
import { InvalidInputError } from './errors/domain-error';

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

/** ترتيب القوائم بتاريخها: الأحدث أولاً أو الأقدم أولاً — ?sort=newest|oldest */
export const SORT_ORDERS = ['newest', 'oldest'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** ?sort= كما وصل: newest أو oldest أو لا شيء، وغيرهما 400 لا ترتيب صامت */
export function sortOf(raw?: string): SortOrder | undefined {
  if (!raw) return undefined;
  if ((SORT_ORDERS as readonly string[]).includes(raw)) return raw as SortOrder;
  throw new InvalidInputError('الترتيب newest (الأحدث أولاً) أو oldest (الأقدم أولاً).', { sort: raw });
}

/** اتجاه Prisma — وبلا ترتيب مطلوب، ترتيب القائمة المعتاد (الطوابير بالأقدم، والسجلات بالأحدث) */
export const dirOf = (sort: SortOrder | undefined, fallback: SortOrder): 'asc' | 'desc' => ((sort ?? fallback) === 'oldest' ? 'asc' : 'desc');
