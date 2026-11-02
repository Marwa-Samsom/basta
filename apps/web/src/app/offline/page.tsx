import type { Metadata } from 'next';
import { Icon } from '@/components/icons';
import { serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('بلا اتصال', 'Offline'), robots: { index: false } };
}

/**
 * SH-07 — صفحة انقطاع الاتصال. يعرضها عامل الخدمة حين لا شبكة ولا نسخة
 * محفوظة من الصفحة المطلوبة. الصفحات التي زارها المشتري من قبل تُفتح من ذاكرته.
 *
 * «أعد المحاولة» رابط إلى العنوان الحالي نفسه (`href=""`) لا سكربت: عامل الخدمة
 * يعرض هذه الصفحة في مكان الصفحة المطلوبة، فإعادة فتح العنوان هي المحاولة.
 */
export default async function OfflinePage() {
  const t = await serverT();
  return (
    <main className="ac-state">
      <div className="ac-state__box">
        <span className="ac-state__icon" aria-hidden>
          <Icon name="wifi-off" size={32} />
        </span>
        <h1 className="ac-state__title">{t('لا يوجد اتصال بالإنترنت', 'No internet connection')}</h1>
        <p className="ac-state__body">
          {t(
            'تحقّق من اتصالك ثم أعد المحاولة. الصفحات التي زرتها من قبل متاحة الآن من جهازك.',
            'Check your connection, then try again. Pages you visited before are available from your device.',
          )}
        </p>
        <p className="ac-state__note">
          {t('السلة والدفع وطلباتك تحتاج اتصالاً — ارجع إليها حين يعود.', 'Your cart, checkout and orders need a connection — come back to them when it returns.')}
        </p>
        <div className="ac-state__actions">
          <a className="btn btn--primary" href="">
            <Icon name="refresh" size={16} />
            {t('أعد المحاولة', 'Try again')}
          </a>
          <a className="btn btn--secondary" href="/">
            {t('الرئيسية', 'Home')}
          </a>
        </div>
      </div>
    </main>
  );
}
