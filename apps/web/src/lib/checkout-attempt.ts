import { ApiError } from './api';

/**
 * مفتاح عدم التكرار لمحاولة الدفع (ADR-011): المفتاح نفسه يعيد الطلب نفسه، فلا
 * يُدفع مرتين. قاعدته الوحيدة: **لا مفتاح جديد ما دام ممكناً أن السابق خُصم**.
 *
 * - يعيش في sessionStorage لا في الذاكرة: إعادة تحميل الصفحة بعد 504 كانت تصنع
 *   مفتاحاً جديداً — فطلباً ثانياً ودفعة ثانية.
 * - مربوط برمز السلة: سلة أخرى محاولة أخرى.
 * - يُنهى حين يجيب الخادم بنتيجة (أي نتيجة: الطلب موجود ومعروف، والسلة التالية
 *   شراء جديد)، أو يرفض رفضاً قاطعاً قبل أي مال (definitive).
 */
const STORE = 'basta.checkout.attempt';

export function attemptKey(cartToken: string | null): string {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORE) ?? 'null') as { cart?: unknown; key?: unknown } | null;
    if (saved && saved.cart === cartToken && typeof saved.key === 'string') return saved.key;
  } catch {
    // تخزين محجوب أو تالف — مفتاح جديد في الذاكرة يكفي هذه الصفحة
  }
  const key = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(STORE, JSON.stringify({ cart: cartToken, key }));
  } catch {
    // كما أعلاه
  }
  return key;
}

export function endAttempt(): void {
  try {
    window.sessionStorage.removeItem(STORE);
  } catch {
    // لا شيء يُمسح
  }
}

/**
 * رفض من خادمنا قبل أي مال: تحقّق (400)، موانع أو مخزون أو إجمالي تغيّر أو
 * كوبون (409)، ومدخل مرفوض (422) — كلها تسبق إنشاء الطلب والدفع.
 *
 * وما عداها لا يقول شيئاً عمّا جرى خلفه: 502 و 504 من وسيط انتهت مهلته والخادم
 * ما زال يدفع، 500 بعد الخصم، 408، وانقطاع الشبكة. عندها يبقى المفتاح، فتعيد
 * المحاولة التالية الطلب نفسه إن كان أُنشئ — لا تنشئ ثانياً.
 */
export function definitive(err: unknown): boolean {
  return err instanceof ApiError && [400, 409, 422].includes(err.status);
}
