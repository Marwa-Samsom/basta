/**
 * التخزين الدائم في المتصفّح (localStorage) بلا سقوط.
 *
 * متصفّح يحجب بيانات الموقع (تصفّح خاص صارم، أو منع ملفات تعريف الارتباط للموقع)
 * يرمي SecurityError عند مجرّد لمس `window.localStorage`. رمز الدخول ورمز السلة كانا
 * يُقرآن بلا حماية، فيسقط المتجر واللوحتان كاملةً عند أول رسم لجرس الإشعارات أو زرّ
 * السلة — صفحة «حدث خلل غير متوقّع» (DISC-002، 29 أكتوبر 2026).
 *
 * حين يُحجب التخزين يبقى المكتوب في ذاكرة الصفحة: الدخول والسلة يعملان في هذا
 * التبويب حتى إعادة التحميل، ثم يعود الزائر ضيفاً — لا صفحة خطأ.
 */
const memory = new Map<string, string>();

export const localStore = {
  get(key: string): string | null {
    if (typeof window === 'undefined') return null;
    if (memory.has(key)) return memory.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value);
    }
  },
  remove(key: string): void {
    if (typeof window === 'undefined') return;
    memory.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // محجوب: لا شيء محفوظ هناك أصلاً
    }
  },
};
