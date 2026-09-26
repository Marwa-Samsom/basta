'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Alert, PageHead, Spinner, TextArea } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useOnboarding, type Onboarding } from '@/lib/vendor';

const MAX = 2000;

/**
 * VD-05 — ملف المتجر.
 *
 * الوصف والسياستان محتوى يقرؤه المشتري قبل أن يشتري، فالمعاينة بجانب الحقل
 * لا في صفحة أخرى: ما يُكتب هنا يظهر هناك.
 */
export default function StorePage() {
  const router = useRouter();
  const { data, loading, missing, error, set } = useOnboarding();
  const [form, setForm] = useState<{
    descriptionAr: string;
    descriptionEn: string;
    shippingPolicyAr: string;
    returnPolicyAr: string;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * النموذج يُشتقّ من المحفوظ بلا تأثير ينسخه: النسخ داخل تأثير يعني تصييراً
   * ثانياً بعد كل تحميل، ويعني أيضاً أن أول تصيير يعرض حقولاً فارغة ثم تمتلئ.
   * `null` هنا تعني «لم يصل المحفوظ بعد»، وبوصوله يصير هو القيمة الأولى.
   */
  const values = form ?? {
    descriptionAr: data?.descriptionAr ?? '',
    descriptionEn: data?.descriptionEn ?? '',
    shippingPolicyAr: data?.shippingPolicyAr ?? '',
    returnPolicyAr: data?.returnPolicyAr ?? '',
  };

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <div className="vo-store">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="vo-store">
        <Alert tone="danger">{error ?? 'تعذّر تحميل ملف المتجر.'}</Alert>
      </div>
    );
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      set(await api<Onboarding>('/vendor/onboarding/profile', { method: 'PATCH', body: values }));
      setSaved(true);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'تعذّر حفظ ملف المتجر.');
    } finally {
      setBusy(false);
    }
  }

  const since = data.approvedAt ? new Date(data.approvedAt).getFullYear() : null;

  return (
    <div className="vo-store">
      <PageHead
        title="ملف المتجر"
        meta={<span className="num">basta.com/s/{data.slug}</span>}
        actions={
          <a className="btn btn--secondary" href={`/s/${data.slug}`} target="_blank" rel="noopener noreferrer">
            <Icon name="eye" size={16} />
            عاين صفحة متجري
          </a>
        }
      />
      <p className="vo-store__lead">هذا ما يراه المشتري في صفحة متجرك، والمعاينة بجانب الحقول تتحدّث أثناء الكتابة.</p>

      <div className="vo-store__grid">
        <form className="vo-col" onSubmit={save} noValidate>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {saved && !failure ? <Alert tone="success">حُفظ ملف المتجر.</Alert> : null}

          <section className="card" aria-labelledby="store-texts">
            <h2 className="vo-side-title" id="store-texts">
              الوصف والسياسات
            </h2>

            <div className="vo-count" data-near={values.descriptionAr.length > MAX * 0.9}>
              <TextArea
                label="الوصف بالعربية"
                hint={`${values.descriptionAr.length} / ${MAX}`}
                maxLength={MAX}
                rows={3}
                value={values.descriptionAr}
                onChange={(e) => setForm({ ...values, descriptionAr: e.target.value })}
              />
            </div>

            <TextArea
              label="الوصف بالإنجليزية"
              optional
              dir="ltr"
              maxLength={MAX}
              rows={2}
              value={values.descriptionEn}
              onChange={(e) => setForm({ ...values, descriptionEn: e.target.value })}
            />

            <div className="grid-2">
              <TextArea
                label="سياسة الشحن"
                maxLength={MAX}
                rows={2}
                value={values.shippingPolicyAr}
                onChange={(e) => setForm({ ...values, shippingPolicyAr: e.target.value })}
              />
              <TextArea
                label="سياسة الإرجاع"
                maxLength={MAX}
                rows={2}
                value={values.returnPolicyAr}
                onChange={(e) => setForm({ ...values, returnPolicyAr: e.target.value })}
              />
            </div>
            <p className="card__hint">تظهر السياستان للمشتري قبل الشراء وتقلّلان الأسئلة والنزاعات.</p>

            <div className="vo-actions">
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
                {busy ? 'جارٍ الحفظ…' : 'حفظ الملف'}
              </button>
            </div>
          </section>
        </form>

        <aside className="vo-preview" aria-label="معاينة صفحة المتجر">
          <span className="vo-preview__eyebrow eyebrow">معاينة حيّة</span>
          <div className="vo-preview__card" data-density="comfortable">
            <div className="vo-preview__cover" aria-hidden />
            <div className="vo-preview__body">
              <div className="vo-preview__ident">
                <span className="vo-preview__logo" aria-hidden>
                  <Icon name="store" size={26} />
                </span>
                <div className="vo-preview__meta">
                  <span className="vo-preview__title">
                    <span className="vo-preview__name">{data.nameAr}</span>
                    {data.status === 'approved' ? (
                      <span className="badge badge--success">
                        <Icon name="shield" size={12} />
                        موثّق
                      </span>
                    ) : null}
                  </span>
                  <span className="vo-preview__sub">
                    {data.nameEn ? <bdi>{data.nameEn}</bdi> : null}
                    {data.nameEn ? ' · ' : ''}
                    {since ? (
                      <>
                        على بسطة منذ <span className="num">{since}</span> ·{' '}
                      </>
                    ) : null}
                    عملة المتجر <span className="num">{data.settlementCurrency}</span>
                  </span>
                </div>
              </div>

              <p className="vo-preview__desc" data-empty={!values.descriptionAr || undefined}>
                {values.descriptionAr || 'أضف وصفاً عربياً ليعرف المشتري ماذا تبيع ومن أين تشحن.'}
              </p>

              <div className="vo-preview__policies">
                <p className="vo-preview__policy" data-empty={!values.shippingPolicyAr || undefined}>
                  <Icon name="package" size={14} />
                  <span>
                    <span className="visually-hidden">الشحن: </span>
                    {values.shippingPolicyAr || 'لم تُكتب سياسة شحن.'}
                  </span>
                </p>
                <p className="vo-preview__policy" data-empty={!values.returnPolicyAr || undefined}>
                  <Icon name="refresh" size={14} />
                  <span>
                    <span className="visually-hidden">الإرجاع: </span>
                    {values.returnPolicyAr || 'لم تُكتب سياسة إرجاع.'}
                  </span>
                </p>
              </div>
            </div>
          </div>
          <p className="vo-preview__foot">هكذا يظهر رأس صفحة متجرك للمشترين.</p>
        </aside>
      </div>
    </div>
  );
}
