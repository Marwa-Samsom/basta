'use client';

import Link from 'next/link';
import { Alert, StatusBadge } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useOnboarding, type Onboarding } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';

const DATE = new Intl.DateTimeFormat('ar-JO-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });

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

/**
 * VD-03 — حالة الطلب.
 *
 * في المراجعة: يقول للبائع ما يستطيع فعله الآن بدل «انتظر».
 * في الرفض: السبب كما كتبه المراجع حرفياً، وطريق واحد واضح للإصلاح.
 */
export default function StatusPage() {
  const { data, loading, missing, error, reload } = useOnboarding();

  // التحويل إلى التسجيل في useOnboarding نفسه، بعد الرسم
  if (missing) return null;
  if (loading && !data) {
    return (
      <OnboardingFrame step={5}>
        <OnboardingLoading label="جارٍ تحميل حالة طلبك…" />
      </OnboardingFrame>
    );
  }
  if (error || !data) {
    return (
      <OnboardingFrame step={5}>
        <OnboardingError message={error ?? 'تعذّر تحميل حالة المتجر.'} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  const submitted = data.submittedAt ? DATE.format(new Date(data.submittedAt)) : null;
  const rejectedDocs = data.documents.filter((d) => d.status === 'rejected');
  const acceptedCount = data.documents.filter((d) => d.status === 'accepted').length;

  return (
    <OnboardingFrame step={stepOf(data)} status={data.status}>
      <OnboardingHead title={TITLE[data.status] ?? 'حالة متجرك'} lead={data.nameAr} />

      <div className="vo-split vo-split--status">
        <div className="vo-col">
          {data.status === 'in_review' ? (
            <section className="card vo-verdict">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">نراجع وثائق متجرك</h2>
              <p className="vo-verdict__body">
                استلمنا طلبك{submitted ? ` في ${submitted}` : ''}. المراجعة تستغرق يوم عمل إلى ثلاثة أيام،
                وتصلك النتيجة على بريدك، وتستطيع متابعة الحالة من هذه الصفحة.
              </p>
            </section>
          ) : null}

          {data.status === 'rejected' ? (
            <section className="card vo-verdict" data-tone="danger">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">طلبك يحتاج تصحيحاً</h2>
              <p className="vo-verdict__body">
                لا حاجة لإعادة التسجيل — أصلح ما طلبته الإدارة ثم أرسل الطلب من جديد.
              </p>
              <div className="vo-rejection" role="alert">
                <Icon name="alert" size={18} />
                <div className="vo-rejection__text">
                  <p className="vo-rejection__title">سبب الرفض كما كتبته الإدارة</p>
                  <p>{data.rejectionReason ?? 'راجع الوثائق المرفوضة.'}</p>
                  {rejectedDocs.length > 0 ? (
                    <ul className="vo-rejection__docs">
                      {rejectedDocs.map((d) => (
                        <li key={d.type} className="vo-docchip">
                          <Icon name="file" size={15} />
                          <span className="vo-docchip__label">{d.label}</span>
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
                  ارفع المستند من جديد
                  <Icon name="next" size={16} mirror />
                </Link>
              </div>
            </section>
          ) : null}

          {data.status === 'pending' ? (
            <section className="card vo-verdict">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">أكمل طلبك وأرسله للمراجعة</h2>
              <p className="vo-verdict__body">
                {data.settlementCurrencyChosen
                  ? 'أكمل الوثائق وبيانات الحساب البنكي ثم أرسل الطلب للمراجعة.'
                  : 'اختر عملة التسوية، ثم أكمل الوثائق وبيانات الحساب البنكي وأرسل الطلب للمراجعة.'}
              </p>
              <div className="vo-actions">
                <Link
                  className="btn btn--primary"
                  href={data.settlementCurrencyChosen ? '/vendor/onboarding/documents' : '/vendor/onboarding/currency'}
                >
                  {data.settlementCurrencyChosen ? 'أكمل الطلب' : 'اختر عملة التسوية'}
                  <Icon name="next" size={16} mirror />
                </Link>
              </div>
            </section>
          ) : null}

          {data.status === 'approved' ? (
            <section className="card vo-verdict" data-tone="success">
              <StatusBadge status={data.status} />
              <h2 className="vo-verdict__head">اعتُمد متجرك — بقي القليل قبل أول بيع</h2>
              {/* العملة اختيرت قبل الإرسال وثبّتها الاعتماد — بقي الملف والمنتجات */}
              <p className="vo-verdict__body">جهّز ملف متجرك وأضف منتجاتك لتبدأ البيع.</p>
              <div className="vo-actions">
                <Link className="btn btn--primary" href="/vendor/store">
                  جهّز ملف المتجر
                  <Icon name="next" size={16} mirror />
                </Link>
                <Link className="btn btn--secondary" href="/vendor/products">
                  منتجاتي
                </Link>
              </div>
            </section>
          ) : null}

          {data.status === 'suspended' ? (
            <Alert tone="warning" title="متجرك معلَّق">
              البيع متوقّف مؤقتاً ولا تظهر منتجاتك للمشترين. راسل الدعم لمعرفة التفاصيل.
            </Alert>
          ) : null}

          {data.status !== 'suspended' && data.status !== 'banned' ? (
            <ReviewTrack vendor={data} submitted={submitted} />
          ) : null}
        </div>

        <aside className="vo-col">
          {data.status === 'in_review' ? (
            <section className="card">
              <h3 className="vo-side-title">ما يمكنك فعله الآن</h3>
              <p className="vo-side-text">
                جهّز منتجاتك كمسودّات — تستطيع إرسالها للنشر فور اعتماد متجرك.
              </p>
              <Link className="btn btn--secondary vo-fit" href="/vendor/products">
                <Icon name="package" size={17} />
                هيّئ منتجاتك
              </Link>
            </section>
          ) : null}

          <section className="card">
            <h3 className="vo-side-title">ملخّص طلبك</h3>
            <dl className="vo-summary">
              <div className="vo-summary__row">
                <dt>المتجر</dt>
                <dd>{data.nameAr}</dd>
              </div>
              <div className="vo-summary__row">
                <dt>الرابط</dt>
                <dd className="num">basta.com/s/{data.slug}</dd>
              </div>
              <div className="vo-summary__row">
                <dt>المستندات المقبولة</dt>
                <dd>
                  <span className="num">{acceptedCount}</span> من <span className="num">{data.documents.length}</span>
                </dd>
              </div>
              {submitted ? (
                <div className="vo-summary__row">
                  <dt>أُرسل في</dt>
                  <dd className="vo-summary__date">{submitted}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="card">
            <h3 className="vo-side-title">الوثائق</h3>
            <ul className="vo-doclist">
              {data.documents.map((d) => (
                <li key={d.type}>
                  <span className="vo-doclist__name">
                    <span>{d.label}</span>
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
  const rejected = vendor.status === 'rejected';
  const approved = vendor.status === 'approved';
  // عدد العقد المكتملة: لا شيء قبل الإرسال، واحدة أثناء المراجعة، والكل بعد القرار
  const reached = vendor.status === 'pending' ? 0 : vendor.status === 'in_review' ? 1 : 3;

  const nodes: { label: string; date: string | null }[] = [
    { label: 'أُرسل الطلب', date: submitted },
    { label: 'قيد المراجعة', date: null },
    {
      label: rejected ? 'طُلب تعديل' : approved ? 'اعتُمد' : 'القرار',
      date: approved && vendor.approvedAt ? DATE.format(new Date(vendor.approvedAt)) : null,
    },
  ];

  return (
    <section className="card">
      <div className="vo-track-head">
        <h3 className="vo-side-title">مسار المراجعة</h3>
        <span className="vo-track-head__dir" aria-hidden>
          يتقدّم بهذا الاتجاه
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
