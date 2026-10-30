/**
 * قيمة إعداد عددي كما خزّنتها الإدارة، بحدّها الأدنى المسموح في شاشة الإعدادات.
 *
 * كان القارئ يقبل «أكبر من صفر» وحده، و«تعليق رصيد البائع» و«مهلة الإرجاع» حدّهما الأدنى صفر:
 * تحفظهما الإدارة صفراً فيعودان 14 يوماً بصمت (VOPS-072، 29 أكتوبر 2026). والتالف في القاعدة
 * (نصّ فارغ، null، سالب) يعود إلى القيمة الافتراضية — لا يصير صفراً.
 */
export function settingNumber(raw: unknown, fallback: number, min: number): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= min ? value : fallback;
}
