/**
 * أسباب الإرجاع بالعربي — كما في قائمة المشتري. السبب يُكتب في سجلّ الحالات وإشعار البائع،
 * وكان يُكتب رمزاً («size_issue») فيقرؤه البائع والإدارة إنجليزياً (BUY-047، 28 أكتوبر 2026).
 */
export const RETURN_REASON_LABELS: Readonly<Record<string, string>> = {
  damaged: 'وصل تالفاً',
  wrong_item: 'منتج غير الذي طلبته',
  not_as_described: 'لا يطابق الوصف',
  size_issue: 'المقاس غير مناسب',
  changed_mind: 'غيّرت رأيي',
  other: 'سبب آخر',
};

/**
 * القطع المرتجعة سطراً سطراً: السطر المذكور أكثر من مرة يُجمع في أول ظهوره.
 *
 * الفحص لكل عنصر وحده كان يقبل [{A, 2}, {A, 2}] من سطر فيه 3 — كلٌّ منهما أقل من 3 —
 * فيُطلب إرجاع 4 قطع ويُحسب نصيبها من المدفوع (BUY-044). يمرّ به الطلب والاسترداد
 * وقيوده، فلا يُقاس المتاح إلا على مجموع السطر.
 */
export function mergeReturnLines(items: readonly { orderItemId: string; qty: number }[]): { orderItemId: string; qty: number }[] {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.orderItemId, (merged.get(i.orderItemId) ?? 0) + i.qty);
  return [...merged].map(([orderItemId, qty]) => ({ orderItemId, qty }));
}
