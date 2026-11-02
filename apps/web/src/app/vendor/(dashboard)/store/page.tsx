'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Alert, PageHead, Spinner, TextArea } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useOnboarding, type Onboarding } from '@/lib/vendor';
import { useT } from '@/components/locale';

const MAX = 2000;

/**
 * VD-05 — ملف المتجر.
 *
 * الوصف والسياستان محتوى يقرؤه المشتري قبل أن يشتري، فالمعاينة بجانب الحقل
 * لا في صفحة أخرى: ما يُكتب هنا يظهر هناك.
 */
export default function StorePage() {
  const t = useT();
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

  // التحويل إلى التسجيل في useOnboarding نفسه، بعد الرسم
  if (missing) return null;
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
        <Alert tone="danger">{error ?? t('تعذّر تحميل ملف المتجر.', "Couldn't load the shop profile.")}</Alert>
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
      setFailure(err instanceof Error ? err.message : t('تعذّر حفظ ملف المتجر.', "Couldn't save the shop profile."));
    } finally {
      setBusy(false);
    }
  }

  const since = data.approvedAt ? new Date(data.approvedAt).getFullYear() : null;

  return (
    <div className="vo-store">
      <PageHead
        title={t('ملف المتجر', 'Shop profile')}
        meta={<span className="num">basta.com/s/{data.slug}</span>}
        actions={
          <a className="btn btn--secondary" href={`/s/${data.slug}`} target="_blank" rel="noopener noreferrer">
            <Icon name="eye" size={16} />
            {t('عاين صفحة متجري', 'Preview my shop page')}
          </a>
        }
      />
      <p className="vo-store__lead">
        {t(
          'هذا ما يراه المشتري في صفحة متجرك، والمعاينة بجانب الحقول تتحدّث أثناء الكتابة.',
          'This is what buyers see on your shop page, and the preview next to the fields updates as you type.',
        )}
      </p>

      <div className="vo-store__grid">
        <form className="vo-col" onSubmit={save} noValidate>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {saved && !failure ? <Alert tone="success">{t('حُفظ ملف المتجر.', 'Shop profile saved.')}</Alert> : null}

          <section className="card" aria-labelledby="store-texts">
            <h2 className="vo-side-title" id="store-texts">
              {t('الوصف والسياسات', 'Description and policies')}
            </h2>

            <div className="vo-count" data-near={values.descriptionAr.length > MAX * 0.9}>
              <TextArea
                label={t('الوصف بالعربية', 'Description in Arabic')}
                hint={`${values.descriptionAr.length} / ${MAX}`}
                maxLength={MAX}
                rows={3}
                value={values.descriptionAr}
                onChange={(e) => setForm({ ...values, descriptionAr: e.target.value })}
              />
            </div>

            <TextArea
              label={t('الوصف بالإنجليزية', 'Description in English')}
              optional
              dir="ltr"
              maxLength={MAX}
              rows={2}
              value={values.descriptionEn}
              onChange={(e) => setForm({ ...values, descriptionEn: e.target.value })}
            />

            <div className="grid-2">
              <TextArea
                label={t('سياسة الشحن', 'Shipping policy')}
                maxLength={MAX}
                rows={2}
                value={values.shippingPolicyAr}
                onChange={(e) => setForm({ ...values, shippingPolicyAr: e.target.value })}
              />
              <TextArea
                label={t('سياسة الإرجاع', 'Return policy')}
                maxLength={MAX}
                rows={2}
                value={values.returnPolicyAr}
                onChange={(e) => setForm({ ...values, returnPolicyAr: e.target.value })}
              />
            </div>
            <p className="card__hint">
              {t(
                'تظهر السياستان للمشتري قبل الشراء وتقلّلان الأسئلة والنزاعات.',
                'Buyers see both policies before they buy, which cuts down on questions and disputes.',
              )}
            </p>

            <div className="vo-actions">
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
                {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ الملف', 'Save profile')}
              </button>
            </div>
          </section>
        </form>

        <aside className="vo-preview" aria-label={t('معاينة صفحة المتجر', 'Shop page preview')}>
          <span className="vo-preview__eyebrow eyebrow">{t('معاينة حيّة', 'Live preview')}</span>
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
                        {t('موثّق', 'Verified')}
                      </span>
                    ) : null}
                  </span>
                  <span className="vo-preview__sub">
                    {data.nameEn ? <bdi>{data.nameEn}</bdi> : null}
                    {data.nameEn ? ' · ' : ''}
                    {since ? (
                      <>
                        {t(`على بسطة منذ ${since}`, `On Basta since ${since}`)} ·{' '}
                      </>
                    ) : null}
                    {t('عملة المتجر', 'Shop currency')} <span className="num">{data.settlementCurrency}</span>
                  </span>
                </div>
              </div>

              <p className="vo-preview__desc" data-empty={!values.descriptionAr || undefined}>
                {values.descriptionAr ||
                  t(
                    'أضف وصفاً عربياً ليعرف المشتري ماذا تبيع ومن أين تشحن.',
                    'Add an Arabic description so buyers know what you sell and where you ship from.',
                  )}
              </p>

              <div className="vo-preview__policies">
                <p className="vo-preview__policy" data-empty={!values.shippingPolicyAr || undefined}>
                  <Icon name="package" size={14} />
                  <span>
                    <span className="visually-hidden">{t('الشحن: ', 'Shipping: ')}</span>
                    {values.shippingPolicyAr || t('لم تُكتب سياسة شحن.', 'No shipping policy written.')}
                  </span>
                </p>
                <p className="vo-preview__policy" data-empty={!values.returnPolicyAr || undefined}>
                  <Icon name="refresh" size={14} />
                  <span>
                    <span className="visually-hidden">{t('الإرجاع: ', 'Returns: ')}</span>
                    {values.returnPolicyAr || t('لم تُكتب سياسة إرجاع.', 'No return policy written.')}
                  </span>
                </p>
              </div>
            </div>
          </div>
          <p className="vo-preview__foot">{t('هكذا يظهر رأس صفحة متجرك للمشترين.', 'This is how the top of your shop page looks to buyers.')}</p>
        </aside>
      </div>
    </div>
  );
}
