'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, session, type Tokens } from '@/lib/api';
import { Alert, Card, Field, Stepper, TextInput } from '@/components/ui';
import { COUNTRIES, type Onboarding } from '@/lib/vendor';

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion: string;
}

/**
 * VD-01 — تسجيل المتجر.
 *
 * الرابط يُشتقّ من الاسم الإنجليزي ويُفحص أثناء الكتابة بتأخير: الفحص عند كل
 * ضغطة مفتاح يُغرق الخادم، والفحص عند الإرسال وحده يُفاجئ البائع بعد أن أتمّ
 * النموذج. والمستعمَل يُقترح له بديل جاهز بدل رفض جاف.
 */
export default function VendorRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    nameAr: '',
    nameEn: '',
    slug: '',
    country: 'JO',
    businessType: 'individual',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const candidate = slugTouched ? form.slug : form.nameEn || form.nameAr;

  /**
   * الفحص بتأخير 400 مللي ثانية: عند كل ضغطة مفتاح يُغرق الخادم، وعند
   * الإرسال وحده يفاجئ البائع بعد أن أتمّ النموذج. وكل ضبط للحالة يقع داخل
   * المؤقّت لا في جسد التأثير — الضبط المتزامن هناك يُطلق تصييراً متتالياً.
   */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (candidate.trim().length < 2) {
        setCheck(null);
        return;
      }
      setChecking(true);
      try {
        setCheck(
          await api<SlugCheck>(`/vendor/onboarding/slug-available?value=${encodeURIComponent(candidate)}`),
        );
      } catch {
        setCheck(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [candidate]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ vendor: Onboarding; tokens: Tokens }>('/vendor/onboarding/apply', {
        method: 'POST',
        body: {
          nameAr: form.nameAr,
          ...(form.nameEn ? { nameEn: form.nameEn } : {}),
          ...(check?.slug ? { slug: check.slug } : {}),
          country: form.country,
          businessType: form.businessType,
        },
      });
      // الرمز الجديد يحمل دور البائع — بدونه ترتدّ الخطوة التالية 403
      session.write(res.tokens);
      router.push('/vendor/onboarding/documents');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login?next=/vendor/register');
        return;
      }
      setError(err instanceof Error ? err.message : 'تعذّر تسجيل المتجر.');
    } finally {
      setBusy(false);
    }
  }

  const slugState = check
    ? check.available
      ? { hint: `الرابط متاح: basta.com/s/${check.slug}`, error: null }
      : { hint: undefined, error: `الرابط مستعمَل. المقترح: ${check.suggestion}` }
    : { hint: 'يُشتقّ من الاسم الإنجليزي، وتستطيع تغييره.', error: null };

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <h1>سجّل متجرك</h1>
        <p className="muted">أربع خطوات، ثم يراجع فريقنا وثائقك.</p>
      </header>

      <Stepper current="المتجر" />

      <Card title="بيانات المتجر">
        <form className="stack" onSubmit={submit} noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <TextInput
            label="اسم المتجر بالعربية"
            required
            maxLength={80}
            value={form.nameAr}
            onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
          />

          <TextInput
            label="اسم المتجر بالإنجليزية"
            optional
            dir="ltr"
            maxLength={80}
            value={form.nameEn}
            onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
          />

          <TextInput
            label="رابط المتجر"
            dir="ltr"
            value={slugTouched ? form.slug : (check?.slug ?? '')}
            hint={slugState.hint}
            error={slugState.error}
            onChange={(e) => {
              setSlugTouched(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
            }}
          />

          {check && !check.available ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setSlugTouched(true);
                setForm((f) => ({ ...f, slug: check.suggestion }));
              }}
            >
              استعمل {check.suggestion}
            </button>
          ) : null}
          {checking ? <p className="small muted">يُفحص التوفّر…</p> : null}

          <div className="grid-2">
            <Field label="البلد">
              {(props) => (
                <select
                  className="field__control"
                  {...props}
                  value={form.country}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.nameAr}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="نوع النشاط">
              {(props) => (
                <select
                  className="field__control"
                  {...props}
                  value={form.businessType}
                  onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value }))}
                >
                  <option value="individual">فرد</option>
                  <option value="company">شركة</option>
                </select>
              )}
            </Field>
          </div>

          <button
            className="btn btn--primary btn--block"
            type="submit"
            disabled={busy || form.nameAr.trim().length < 2 || check?.available === false}
          >
            {busy ? 'جارٍ التسجيل…' : 'التالي: الوثائق'}
          </button>
        </form>
      </Card>
    </main>
  );
}
