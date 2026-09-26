'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, session, type Tokens } from '@/lib/api';
import { Alert, Field, TextInput } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { COUNTRIES, type Onboarding } from '@/lib/vendor';
import { OnboardingFrame, OnboardingHead } from '../onboarding/onboarding-chrome';

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion: string;
}

const BUSINESS_TYPES = [
  { value: 'individual', label: 'فرد', hint: 'سجل تجاري فردي أو عمل حر' },
  { value: 'company', label: 'شركة', hint: 'شركة ذات مسؤولية محدودة أو أكبر' },
] as const;

/**
 * VD-01 — تسجيل المتجر.
 *
 * الرابط يُشتقّ من الاسم الإنجليزي ويُفحص أثناء الكتابة بتأخير: الفحص عند كل
 * ضغطة مفتاح يُغرق الخادم، والفحص عند الإرسال وحده يُفاجئ البائع بعد أن أتمّ
 * النموذج. والمستعمَل يُقترح له بديل جاهز بدل رفض جاف.
 *
 * خطوة «الحساب» في التصميم تمّت قبل هذه الصفحة: الوصول إليها يتطلّب دخولاً،
 * فالشريط يعرضها مكتملة والنموذج يبدأ من المتجر.
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

  /**
   * حالة الرابط أربع كما في التصميم: فارغ، يُفحص، متاح، محجوز. والأيقونة
   * داخل الحقل تتبعها، والرسالة تحته بلونها — المتاح أخضر لا رمادي.
   */
  const slugState: 'idle' | 'checking' | 'ok' | 'taken' = checking
    ? 'checking'
    : check
      ? check.available
        ? 'ok'
        : 'taken'
      : 'idle';
  const slugIcon: Record<typeof slugState, IconName> = {
    idle: 'info',
    checking: 'spinner',
    ok: 'check-circle',
    taken: 'alert',
  };
  const slugHint =
    slugState === 'ok'
      ? 'الرابط متاح.'
      : slugState === 'checking'
        ? 'نتحقّق من توفّر الرابط…'
        : 'يُشتقّ من الاسم الإنجليزي، وتستطيع تغييره.';
  const slugError = slugState === 'taken' ? 'الرابط محجوز لمتجر آخر — اختر رابطاً غيره.' : null;
  const slugValue = slugTouched ? form.slug : (check?.slug ?? '');

  return (
    <OnboardingFrame step={2}>
      <OnboardingHead
        title="سجّل متجرك على بسطة"
        lead="بيانات متجرك الأساسية أولاً، والمستندات في الخطوة التالية."
      />

      <div className="vo-split">
        <section className="card">
          <h2 className="vo-card-title">بيانات المتجر</h2>

          <form className="vo-form" onSubmit={submit} noValidate>
            {error ? <Alert tone="danger">{error}</Alert> : null}

            <div className="grid-2">
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
                hint="يُولَّد رابط المتجر تلقائياً من الاسم الإنجليزي."
                value={form.nameEn}
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
              />
            </div>

            <div className="vo-slug-field" data-state={slugState}>
              <Field label="رابط المتجر" hint={slugHint} error={slugError}>
                {(props) => (
                  <span className="vo-slug" dir="ltr" data-state={slugState}>
                    <span className="vo-slug__prefix" aria-hidden>
                      basta.com/s/
                    </span>
                    <input
                      className="vo-slug__input"
                      {...props}
                      value={slugValue}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setForm((f) => ({ ...f, slug: e.target.value }));
                      }}
                    />
                    <span className="vo-slug__icon" aria-hidden>
                      <Icon
                        name={slugIcon[slugState]}
                        size={17}
                        {...(slugState === 'checking' ? { className: 'vo-spin' } : {})}
                      />
                    </span>
                  </span>
                )}
              </Field>
            </div>

            {check && !check.available ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm vo-fit"
                onClick={() => {
                  setSlugTouched(true);
                  setForm((f) => ({ ...f, slug: check.suggestion }));
                }}
              >
                استخدم <span className="num">{check.suggestion}</span>
              </button>
            ) : null}

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

            <fieldset className="vo-choices">
              <legend>نوع النشاط</legend>
              <div className="vo-choices__grid">
                {BUSINESS_TYPES.map((b) => (
                  <label key={b.value} className="vo-radio">
                    <span className="vo-radio__head">
                      <input
                        type="radio"
                        name="businessType"
                        value={b.value}
                        checked={form.businessType === b.value}
                        onChange={() => setForm((f) => ({ ...f, businessType: b.value }))}
                      />
                      {b.label}
                    </span>
                    <span className="vo-radio__hint">{b.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="vo-actions">
              <button
                className="btn btn--primary"
                type="submit"
                disabled={busy || form.nameAr.trim().length < 2 || check?.available === false}
              >
                {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
                {busy ? 'جارٍ التسجيل…' : 'التالي: المستندات'}
                {busy ? null : <Icon name="next" size={16} mirror />}
              </button>
            </div>
          </form>
        </section>

        <aside className="vo-col">
          <section className="card">
            <h3 className="vo-side-title">معاينة رابط المتجر</h3>
            <div className="vo-urlbox">
              <span className="vo-urlbox__url" dir="ltr">
                basta.com/s/{slugValue || '…'}
              </span>
              <span className="vo-shopline">
                <span className="vo-shopline__icon" aria-hidden>
                  <Icon name="store" size={20} />
                </span>
                <span className="vo-shopline__text">
                  <span className="vo-shopline__name">{form.nameAr || 'اسم متجرك'}</span>
                  {form.nameEn ? (
                    <span className="vo-shopline__en" dir="ltr">
                      {form.nameEn}
                    </span>
                  ) : null}
                </span>
              </span>
            </div>
            <div className="vo-note">
              <span className="vo-note__title">الرابط لا يتغيّر بسهولة</span>
              <span className="vo-note__text">
                تغييره بعد النشر يكسر الروابط المحفوظة عند المشترين، لذا اخترْه بعناية الآن.
              </span>
            </div>
          </section>

          <section className="card">
            <h3 className="vo-side-title">ما تحتاجه للتسجيل</h3>
            <ul className="vo-checklist">
              <li>
                <Icon name="check-circle" size={16} />
                سجل تجاري ساري وهوية صاحب النشاط
              </li>
              <li>
                <Icon name="check-circle" size={16} />
                شهادة ضريبية وحساب بنكي باسم النشاط
              </li>
              <li>
                <Icon name="check-circle" size={16} />
                تستطيع الحفظ والعودة لاحقاً — كل مستند يُحفظ فور رفعه
              </li>
            </ul>
            <p className="vo-callout vo-callout--info">
              <Icon name="info" size={16} />
              <span>تُراجَع المستندات خلال يوم عمل إلى ثلاثة أيام، وتصلك النتيجة على بريدك.</span>
            </p>
          </section>
        </aside>
      </div>
    </OnboardingFrame>
  );
}
