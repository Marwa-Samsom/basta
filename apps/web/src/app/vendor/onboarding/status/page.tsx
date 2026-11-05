'use client';

import Link from 'next/link';
import { Alert, StatusBadge } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useOnboarding, type Onboarding } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';
import { useLocale, useT } from '@/components/locale';
import { intlLocale, localized, type Locale } from '@/lib/i18n';

const DATE: Readonly<Record<Locale, Intl.DateTimeFormat>> = {
  ar: new Intl.DateTimeFormat('ar-JO-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }),
  en: new Intl.DateTimeFormat(intlLocale('en'), { dateStyle: 'medium', timeStyle: 'short' }),
};

/** أسماء المستندات بالإنجليزية — الخادم يرسل الاسم بالعربية وحدها، فيُقرأ بالنوع */
const DOC_LABEL_EN: Record<string, string> = {
  commercial_register: 'Commercial register',
  national_id: 'National ID',
  tax_card: 'Tax certificate',
  bank_proof: 'Bank account proof',
};

/** الخطوة في شريط التأهيل تتبع ما بقي فعلاً، لا اسم الصفحة */
function stepOf(vendor: Onboarding): number {
  if (vendor.status === 'pending') return vendor.settlementCurrencyChosen ? 4 : 3;
  if (vendor.status === 'in_review' || vendor.status === 'rejected') return 5;
  return 6;
}

const TITLE: Record<string, string> = {
  pending: 'طلبك لم يُرسل بعد',
  in_review: 'طلبك قيد المراجعة',
  rejected: 'طلبك يحتاج تعديلاً',
  approved: 'متجرك معتمد',
  suspended: 'متجرك معلَّق',
  banned: 'متجرك محظور',
};
const TITLE_EN: Record<string, string> = {
  pending: "Your application hasn't been submitted yet",
  in_review: 'Your application is under review',
  rejected: 'Your application needs changes',
  approved: 'Your shop is approved',
  suspended: 'Your shop is suspended',
  banned: 'Your shop is banned',
};

/**
 * VD-03 — حالة الطلب.
 *
 * في المراجعة: يقول للبائع ما يستطيع فعله الآن بدل «انتظر».
 * في الرفض: السبب كما كتبه المراجع حرفياً، وطريق واحد واضح للإصلاح.
 */
export default function StatusPage() {
  const t = useT();
  const locale = useLocale();
  const docLabel = (d: { type: string; label: string }): string => (locale === 'en' ? (DOC_LABEL_EN[d.type] ?? d.label) : d.label);
  const { data, loading, missing, error, reload } = useOnboarding();

  // التحويل إلى التسجيل في useOnboarding نفسه، بعد الرسم
  if (missing) return null;
  if (loading && !data) {
    return (
      <OnboardingFrame step={5}>
        <OnboardingLoading label={t('جارٍ تحميل حالة طلبك…', 'Loading your application status…')} />
      </OnboardingFrame>
    );
  }
  if (error || !data) {
    return (
      <OnboardingFrame step={5}>
        <OnboardingError message={error ?? t('تعذّر تحميل حالة المتجر.', "Couldn't load your shop status.")} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  const submitted = data.submittedAt ? DATE[locale].format(new Date(data.submittedAt)) : null;
  const shopName = locale === 'en' && data.nameEn ? data.nameEn : data.nameAr;
  const rejectedDocs = data.documents.filter((d) => d.status === 'rejected');
  const acceptedCount = data.documents.filter((d) => d.status === 'accepted').length;

  return (
    <OnboardingFrame step={stepOf(data)} status={data.status}>
      <OnboardingHead
        title={localized(locale, TITLE, TITLE_EN)[data.status] ?? t('حالة متجرك', 'Your shop status')}
        lead={shopName}
      />

      <div className="vo-split vo-split--status">
        <div className="vo-col">
          {data.status === 'in_review' ? (
            <section className="card vo-verdict">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">{t('نراجع وثائق متجرك', "We're reviewing your shop documents")}</h2>
              <p className="vo-verdict__body">
                {t(
                  `استلمنا طلبك${submitted ? ` في ${submitted}` : ''}. المراجعة تستغرق يوم عمل إلى ثلاثة أيام، وتصلك النتيجة على بريدك، وتستطيع متابعة الحالة من هذه الصفحة.`,
                  `We received your application${submitted ? ` on ${submitted}` : ''}. Review takes one to three working days; you'll get the result by email, and you can follow the status on this page.`,
                )}
              </p>
            </section>
          ) : null}

          {data.status === 'rejected' ? (
            <section className="card vo-verdict" data-tone="danger">
              <StatusBadge status={data.status} />
              {/* ما يُفعل لا تكرار العنوان بمرادف — كان «طلبك يحتاج تصحيحاً» تحت «طلبك يحتاج تعديلاً»
                  (VON-051، 28 أكتوبر 2026). «تعديل» كالتصميم وإشعار الرفض، والنمط كبطاقة المسوّدة */}
              <h2 className="vo-verdict__head">{t('عدّل طلبك وأرسله من جديد', 'Update your application and submit it again')}</h2>
              <p className="vo-verdict__body">
                {t(
                  'لا حاجة لإعادة التسجيل — أصلح ما طلبته الإدارة ثم أرسل الطلب من جديد.',
                  "No need to register again — fix what admin asked for, then submit the application again.",
                )}
              </p>
              <div className="vo-rejection" role="alert">
                <Icon name="alert" size={18} />
                <div className="vo-rejection__text">
                  <p className="vo-rejection__title">{t('سبب الرفض كما كتبته الإدارة', 'Rejection reason as written by admin')}</p>
                  <p>{data.rejectionReason ?? t('راجع الوثائق المرفوضة.', 'Check the rejected documents.')}</p>
                  {rejectedDocs.length > 0 ? (
                    <ul className="vo-rejection__docs">
                      {rejectedDocs.map((d) => (
                        <li key={d.type} className="vo-docchip">
                          <Icon name="file" size={15} />
                          <span className="vo-docchip__label">{docLabel(d)}</span>
                          {d.originalName ? (
                            <span className="vo-docchip__file">
                              <bdi>{d.originalName}</bdi>
                            </span>
                          ) : null}
                          {d.rejectReason ? <span className="vo-docchip__reason">{d.rejectReason}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              <div className="vo-actions">
                <Link className="btn btn--primary" href="/vendor/onboarding/documents">
                  {t('ارفع المستند من جديد', 'Upload the document again')}
                  <Icon name="next" size={16} mirror />
                </Link>
              </div>
            </section>
          ) : null}

          {data.status === 'pending' ? (
            <section className="card vo-verdict">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">{t('أكمل طلبك وأرسله للمراجعة', 'Complete your application and submit it for review')}</h2>
              <p className="vo-verdict__body">
                {data.settlementCurrencyChosen
                  ? t(
                      'أكمل الوثائق وبيانات الحساب البنكي ثم أرسل الطلب للمراجعة.',
                      'Complete the documents and bank account details, then submit the application for review.',
                    )
                  : t(
                      'اختر عملة التسوية، ثم أكمل الوثائق وبيانات الحساب البنكي وأرسل الطلب للمراجعة.',
                      'Choose your settlement currency, then complete the documents and bank account details and submit the application for review.',
                    )}
              </p>
              <div className="vo-actions">
                <Link
                  className="btn btn--primary"
                  href={data.settlementCurrencyChosen ? '/vendor/onboarding/documents' : '/vendor/onboarding/currency'}
                >
                  {data.settlementCurrencyChosen
                    ? t('أكمل الطلب', 'Complete the application')
                    : t('اختر عملة التسوية', 'Choose settlement currency')}
                  <Icon name="next" size={16} mirror />
                </Link>
              </div>
            </section>
          ) : null}

          {data.status === 'approved' ? (
            <section className="card vo-verdict" data-tone="success">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">
                {t('اعتُمد متجرك — بقي القليل قبل أول بيع', 'Your shop is approved — just a little left before your first sale')}
              </h2>
              {/* العملة اختيرت قبل الإرسال وثبّتها الاعتماد — بقي الملف والمنتجات */}
              <p className="vo-verdict__body">
                {t('جهّز ملف متجرك وأضف منتجاتك لتبدأ البيع.', 'Set up your shop profile and add your products to start selling.')}
              </p>
              <div className="vo-actions">
                <Link className="btn btn--primary" href="/vendor/store">
                  {t('جهّز ملف المتجر', 'Set up your shop profile')}
                  <Icon name="next" size={16} mirror />
                </Link>
                <Link className="btn btn--secondary" href="/vendor/products">
                  {t('منتجاتي', 'My products')}
                </Link>
              </div>
            </section>
          ) : null}

          {data.status === 'suspended' ? (
            <Alert tone="warning" title={t('متجرك معلَّق', 'Your shop is suspended')}>
              {t(
                'البيع متوقّف مؤقتاً ولا تظهر منتجاتك للمشترين. راسل الدعم لمعرفة التفاصيل.',
                "Selling is paused for now and your products aren't shown to buyers. Contact support for details.",
              )}
            </Alert>
          ) : null}

          {data.status !== 'suspended' && data.status !== 'banned' ? (
            <ReviewTrack vendor={data} submitted={submitted} />
          ) : null}
        </div>

        <aside className="vo-col">
          {data.status === 'in_review' ? (
            <section className="card">
              <h3 className="vo-side-title">{t('ما يمكنك فعله الآن', 'What you can do now')}</h3>
              {/* كشريط اللوحة: قيد المراجعة ينشر الآن ويظهر لحظة الاعتماد — كانت «كمسودّات… فور اعتماد متجرك» (VON-046، ADR-016) */}
              <p className="vo-side-text">
                {t(
                  'أضف منتجاتك وانشرها الآن — تظهر للمشترين تلقائياً لحظة اعتماد متجرك.',
                  'Add your products and publish them now — buyers see them automatically the moment your shop is approved.',
                )}
              </p>
              <Link className="btn btn--secondary vo-fit" href="/vendor/products">
                <Icon name="package" size={17} />
                {t('أضف منتجاتك', 'Add your products')}
              </Link>
            </section>
          ) : null}

          <section className="card">
            <h3 className="vo-side-title">{t('ملخّص طلبك', 'Application summary')}</h3>
            <dl className="vo-summary">
              <div className="vo-summary__row">
                <dt>{t('المتجر', 'Shop')}</dt>
                <dd>{shopName}</dd>
              </div>
              <div className="vo-summary__row">
                <dt>{t('الرابط', 'Link')}</dt>
                <dd className="num">basta.com/s/{data.slug}</dd>
              </div>
              <div className="vo-summary__row">
                <dt>{t('المستندات المقبولة', 'Accepted documents')}</dt>
                <dd>
                  <span className="num">{acceptedCount}</span> {t('من', 'of')} <span className="num">{data.documents.length}</span>
                </dd>
              </div>
              {submitted ? (
                <div className="vo-summary__row">
                  <dt>{t('أُرسل في', 'Submitted on')}</dt>
                  <dd className="vo-summary__date">{submitted}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="card">
            <h3 className="vo-side-title">{t('الوثائق', 'Documents')}</h3>
            <ul className="vo-doclist">
              {data.documents.map((d) => (
                <li key={d.type}>
                  <span className="vo-doclist__name">
                    <span>{docLabel(d)}</span>
                    {d.downloadPath && d.originalName ? (
                      <span className="vo-doclist__file">
                        <bdi>{d.originalName}</bdi>
                      </span>
                    ) : null}
                  </span>
                  <StatusBadge status={d.status} kind="document" />
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </OnboardingFrame>
  );
}

/**
 * مسار المراجعة — ثلاث عقد: أُرسل، قيد المراجعة، القرار. التاريخ يظهر حيث
 * نعرفه فقط؛ لا تاريخ مخترع لبداية المراجعة أو للرفض.
 */
function ReviewTrack({ vendor, submitted }: { vendor: Onboarding; submitted: string | null }) {
  const t = useT();
  const locale = useLocale();
  const rejected = vendor.status === 'rejected';
  const approved = vendor.status === 'approved';
  // عدد العقد المكتملة: لا شيء قبل الإرسال، واحدة أثناء المراجعة، والكل بعد القرار
  const reached = vendor.status === 'pending' ? 0 : vendor.status === 'in_review' ? 1 : 3;

  const nodes: { label: string; date: string | null }[] = [
    { label: t('أُرسل الطلب', 'Application submitted'), date: submitted },
    { label: t('قيد المراجعة', 'Under review'), date: null },
    {
      label: rejected ? t('طُلب تعديل', 'Changes requested') : approved ? t('اعتُمد', 'Approved') : t('القرار', 'Decision'),
      date: approved && vendor.approvedAt ? DATE[locale].format(new Date(vendor.approvedAt)) : null,
    },
  ];

  return (
    <section className="card">
      <div className="vo-track-head">
        <h3 className="vo-side-title">{t('مسار المراجعة', 'Review progress')}</h3>
        <span className="vo-track-head__dir" aria-hidden>
          {t('يتقدّم بهذا الاتجاه', 'Moves in this direction')}
          <Icon name="back" size={15} mirror />
        </span>
      </div>
      <ol className="vo-track">
        {nodes.map((n, i) => {
          const danger = rejected && i === 2;
          const state = danger ? 'danger' : i < reached ? 'done' : i === reached ? 'current' : 'todo';
          const icon: IconName =
            state === 'danger' ? 'alert' : state === 'done' ? 'check' : state === 'current' ? 'clock' : 'minus';
          return (
            <li
              key={n.label}
              className="vo-track__item"
              data-state={state}
              {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              <span className="vo-track__node">
                <span className="vo-track__dot" aria-hidden>
                  <Icon name={icon} size={16} />
                </span>
                <span className="vo-track__label">{n.label}</span>
                {n.date ? <span className="vo-track__date">{n.date}</span> : null}
              </span>
              {i < nodes.length - 1 ? <span className="vo-track__line" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
