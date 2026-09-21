import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'بلا اتصال', robots: { index: false } };

/**
 * صفحة انقطاع الاتصال — يعرضها عامل الخدمة حين لا شبكة ولا نسخة محفوظة من
 * الصفحة المطلوبة. الصفحات التي زارها المشتري من قبل تُفتح من ذاكرته.
 */
export default function OfflinePage() {
  return (
    <main className="shell">
      <h1>لا اتصال بالإنترنت</h1>
      <p className="muted">الصفحات التي زرتها من قبل متاحة الآن من جهازك. السلة والدفع وطلباتك تحتاج اتصالاً — ارجع إليها حين يعود.</p>
      <a className="btn btn--primary" href="/">
        الرئيسية
      </a>
    </main>
  );
}
