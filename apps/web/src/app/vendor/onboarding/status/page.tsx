'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, StatusBadge } from '@/components/ui';
import { useOnboarding } from '@/lib/vendor';

/**
 * VD-03 — حالة الطلب.
 *
 * في المراجعة: يقول للبائع ما يستطيع فعله الآن بدل «انتظر».
 * في الرفض: السبب كما كتبه المراجع حرفياً، وطريق واحد واضح للإصلاح.
 */
export default function StatusPage() {
  const router = useRouter();
  const { data, loading, missing, error } = useOnboarding();

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <main className="shell">
        <Spinner label="جارٍ تحميل حالة طلبك…" />
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="shell">
        <Alert tone="danger">{error ?? 'تعذّر تحميل حالة المتجر.'}</Alert>
      </main>
    );
  }

  const submitted = data.submittedAt
    ? new Intl.DateTimeFormat('ar-JO-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(data.submittedAt),
      )
    : null;

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <div className="row row--between">
          <h1>حالة متجرك</h1>
          <StatusBadge status={data.status} />
        </div>
        <p className="muted">{data.nameAr}</p>
      </header>

      {data.status === 'in_review' ? (
        <Card title="نراجع وثائق متجرك">
          <p>
            استلمنا طلبك{submitted ? ` في ${submitted}` : ''}. المراجعة تستغرق يوم عمل إلى ثلاثة أيام،
            وتصلك النتيجة على بريدك.
          </p>
          <Alert tone="info" title="ما الذي تستطيع فعله الآن؟">
            جهّز منتجاتك كمسودّات — تستطيع إرسالها للنشر فور اعتماد متجرك.
          </Alert>
          <Link className="btn btn--secondary" href="/vendor/products">
            هيّئ منتجاتك
          </Link>
        </Card>
      ) : null}

      {data.status === 'rejected' ? (
        <Card title="طلبك يحتاج تصحيحاً">
          <Alert tone="danger" title="سبب الرفض">
            {data.rejectionReason ?? 'راجع الوثائق المرفوضة.'}
          </Alert>
          <ul className="blockers">
            {data.documents
              .filter((d) => d.status === 'rejected')
              .map((d) => (
                <li key={d.type} className="blockers__item">
                  <span aria-hidden>•</span>
                  <span>
                    {d.label}: {d.rejectReason}
                  </span>
                </li>
              ))}
          </ul>
          <Link className="btn btn--primary" href="/vendor/onboarding/documents">
            ارفع المستند من جديد
          </Link>
        </Card>
      ) : null}

      {data.status === 'pending' ? (
        <Card title="طلبك لم يُرسل بعد">
          <p>أكمل الوثائق وبيانات الحساب البنكي ثم أرسل الطلب للمراجعة.</p>
          <Link className="btn btn--primary" href="/vendor/onboarding/documents">
            أكمل الطلب
          </Link>
        </Card>
      ) : null}

      {data.status === 'approved' ? (
        <Card title="متجرك معتمد">
          {/* النص يتبع ما بقي فعلاً: بائع ثبّت عملته لا يُقال له «ثبّت عملتك» */}
          <p>
            {data.settlementCurrencyLocked
              ? 'جهّز ملف متجرك وأضف منتجاتك لتبدأ البيع.'
              : 'تستطيع الآن تثبيت عملة التسوية ثم تجهيز ملف متجرك ومنتجاتك.'}
          </p>
          <div className="row">
            {!data.settlementCurrencyLocked ? (
              <Link className="btn btn--primary" href="/vendor/onboarding/currency">
                اختر عملة التسوية
              </Link>
            ) : (
              <Link className="btn btn--primary" href="/vendor/store">
                جهّز ملف المتجر
              </Link>
            )}
            <Link className="btn btn--secondary" href="/vendor/products">
              منتجاتي
            </Link>
          </div>
        </Card>
      ) : null}

      {data.status === 'suspended' ? (
        <Alert tone="warning" title="متجرك معلَّق">
          البيع متوقّف مؤقتاً ولا تظهر منتجاتك للمشترين. راسل الدعم لمعرفة التفاصيل.
        </Alert>
      ) : null}

      <Card title="الوثائق">
        <ul className="blockers">
          {data.documents.map((d) => (
            <li key={d.type} className="blockers__item row row--between">
              <span>{d.label}</span>
              <span className="row">
                <StatusBadge status={d.status} kind="document" />
                {d.downloadPath ? (
                  <span className="small muted">{d.originalName ?? ''}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
