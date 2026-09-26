import type { Metadata } from 'next';
import { Icon } from '@/components/icons';

export const metadata: Metadata = { title: 'بلا اتصال', robots: { index: false } };

/**
 * SH-07 — صفحة انقطاع الاتصال. يعرضها عامل الخدمة حين لا شبكة ولا نسخة
 * محفوظة من الصفحة المطلوبة. الصفحات التي زارها المشتري من قبل تُفتح من ذاكرته.
 *
 * «أعد المحاولة» رابط إلى العنوان الحالي نفسه (`href=""`) لا سكربت: عامل الخدمة
 * يعرض هذه الصفحة في مكان الصفحة المطلوبة، فإعادة فتح العنوان هي المحاولة.
 */
export default function OfflinePage() {
  return (
    <main className="ac-state">
      <div className="ac-state__box">
        <span className="ac-state__icon" aria-hidden>
          <Icon name="wifi-off" size={32} />
        </span>
        <h1 className="ac-state__title">لا يوجد اتصال بالإنترنت</h1>
        <p className="ac-state__body">
          تحقّق من اتصالك ثم أعد المحاولة. الصفحات التي زرتها من قبل متاحة الآن من جهازك.
        </p>
        <p className="ac-state__note">السلة والدفع وطلباتك تحتاج اتصالاً — ارجع إليها حين يعود.</p>
        <div className="ac-state__actions">
          <a className="btn btn--primary" href="">
            <Icon name="refresh" size={16} />
            أعد المحاولة
          </a>
          <a className="btn btn--secondary" href="/">
            الرئيسية
          </a>
        </div>
      </div>
    </main>
  );
}
