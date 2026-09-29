/**
 * مفتاح طلب الضيف — يعيده الخادم مع نتيجة الدفع، ويطلبه لقراءة حالة الطلب بلا حساب
 * (رقم الطلب وحده ليس سرّاً). يُحفظ في هذا المتصفّح بجوار رقمه، فتفتح صفحة الطلب
 * بعد إعادة التحميل أو من سجلّ التصفّح. طلب صاحب الحساب لا مفتاح له ولا يحتاجه.
 */
const PREFIX = 'basta.orderKey.';

export function rememberOrderKey(orderNumber: string, key: string | undefined): void {
  if (!key) return;
  try {
    window.localStorage.setItem(PREFIX + orderNumber, key);
  } catch {
    // تخزين محجوب — الصفحة تطلب الحالة بلا مفتاح فيقال للضيف إن الطلب غير متاح هنا
  }
}

export function orderKeyHeaders(orderNumber: string): Record<string, string> {
  try {
    const key = window.localStorage.getItem(PREFIX + orderNumber);
    return key ? { 'x-order-key': key } : {};
  } catch {
    return {};
  }
}
