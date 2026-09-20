'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Card, Spinner, TextArea } from '@/components/ui';
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
    shippingPolicyAr: data?.shippingPolicyAr ?? '',
    returnPolicyAr: data?.returnPolicyAr ?? '',
  };

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <main className="shell">
        <Spinner />
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="shell">
        <Alert tone="danger">{error ?? 'تعذّر تحميل ملف المتجر.'}</Alert>
      </main>
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

  return (
    <main className="shell shell--wide">
      <header className="stack stack--tight">
        <h1>ملف المتجر</h1>
        <p className="muted">ما يراه المشتري في صفحة متجرك: basta.com/s/{data.slug}</p>
      </header>

      <div className="grid-2">
        <form className="stack" onSubmit={save} noValidate>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {saved && !failure ? <Alert tone="success">حُفظ ملف المتجر.</Alert> : null}

          <Card title="التعريف">
            <TextArea
              label="نبذة عن المتجر"
              hint={`${values.descriptionAr.length} من ${MAX} حرف`}
              maxLength={MAX}
              value={values.descriptionAr}
              onChange={(e) => setForm({ ...values, descriptionAr: e.target.value })}
            />
          </Card>

          <Card title="السياسات" hint="تظهر للمشتري قبل الشراء وتقلّل الأسئلة والنزاعات.">
            <TextArea
              label="سياسة الشحن"
              maxLength={MAX}
              value={values.shippingPolicyAr}
              onChange={(e) => setForm({ ...values, shippingPolicyAr: e.target.value })}
            />
            <TextArea
              label="سياسة الإرجاع"
              maxLength={MAX}
              value={values.returnPolicyAr}
              onChange={(e) => setForm({ ...values, returnPolicyAr: e.target.value })}
            />
          </Card>

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ الملف'}
          </button>
        </form>

        <Card title="معاينة صفحة المتجر">
          <div className="stack stack--tight">
            <h3>{data.nameAr}</h3>
            <p className="small muted">
              {data.nameEn ?? ''} {data.nameEn ? '·' : ''} عملة المتجر{' '}
              <span className="num">{data.settlementCurrency}</span>
            </p>
          </div>
          <p>{values.descriptionAr || <span className="muted">لم تُكتب نبذة بعد.</span>}</p>
          <div className="stack stack--tight">
            <span className="field__label">الشحن</span>
            <p className="small">
              {values.shippingPolicyAr || <span className="muted">لم تُكتب سياسة شحن.</span>}
            </p>
          </div>
          <div className="stack stack--tight">
            <span className="field__label">الإرجاع</span>
            <p className="small">
              {values.returnPolicyAr || <span className="muted">لم تُكتب سياسة إرجاع.</span>}
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}
