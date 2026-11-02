'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError, session, type Tokens } from '@/lib/api';
import { Alert, ClearableInput, Field, TextInput } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { withNext } from '@/lib/safe-path';
import { COUNTRIES, type Onboarding } from '@/lib/vendor';
import { OnboardingFrame, OnboardingHead } from '../onboarding/onboarding-chrome';
import { useLocale, useT } from '@/components/locale';

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion: string;
}

/**
 * مسوّدة النموذج في تبويب المتصفّح — جلسة انتهت أثناء الكتابة تحوّل إلى الدخول
 * ثم تعود هنا، وكان ما كُتب يضيع. تُمحى بعد أن يُسجَّل المتجر.
 */
const DRAFT_KEY = 'basta.vendorRegisterDraft';
const BLANK = { nameAr: '', nameEn: '', slug: '', country: 'JO', businessType: 'individual' };
type Draft = { form: typeof BLANK; slugTouched: boolean };

function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null): void {
  try {
    if (draft) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // تخزين محجوب (تصفّح خاص صارم): يبقى النموذج يعمل بلا مسوّدة
  }
}

const subscribeSession = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

const BUSINESS_TYPES = [
  {
    value: 'individual',
    label: 'فرد',
    labelEn: 'Individual',
    hint: 'سجل تجاري فردي أو عمل حر',
    hintEn: 'Sole-trader commercial register or freelance',
  },
  {
    value: 'company',
    label: 'شركة',
    labelEn: 'Company',
    hint: 'شركة ذات مسؤولية محدودة أو أكبر',
    hintEn: 'Limited liability company or larger',
  },
] as const;

/**
 * VD-01 — تسجيل المتجر.
 *
 * الرابط يُشتقّ من الاسم الإنجليزي ويُفحص أثناء الكتابة بتأخير: الفحص عند كل
 * ضغطة مفتاح يُغرق الخادم، والفحص عند الإرسال وحده يُفاجئ البائع بعد أن أتمّ
 * النموذج. والمستعمَل يُقترح له بديل جاهز بدل رفض جاف.
 *
 * خطوة «الحساب» في التصميم تسبق هذه الصفحة: الزائر بلا حساب يرى بطاقة «ابدأ
 * بحسابك» لا النموذج — كان يملؤه ثم يُحوَّل إلى الدخول فيضيع ما كتب. ومن دخل
 * يرى الشريط مكتملاً حتى «الحساب»، والنموذج يبدأ من المتجر.
 *
 * ومن له متجر لم يُرسَل بعد (أو رُفض) يصل هنا بزرّ «رجوع» من المستندات:
 * الصفحة نفسها تصير تعديلاً — تملأ النموذج من متجره وتحفظ عبر
 * `PATCH /vendor/onboarding/shop`. التسجيل ثانيةً كان يُرفض بـ«لديك متجر».
 */
export default function VendorRegisterPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const signedIn = useSyncExternalStore(subscribeSession, () => !!session.read(), () => false);
  const [form, setForm] = useState(BLANK);
  const [slugTouched, setSlugTouched] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [existing, setExisting] = useState<Onboarding | null>(null);
  const existingSlug = existing?.slug ?? null;
  // المسوّدة تُكتب بعد أن يُعرف إن كان للحساب متجر — قبلها كانت الكتابة الأولى تمحوها قبل استعادتها
  const draftReady = useRef(false);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api<Onboarding>('/vendor/onboarding')
      .then((v) => {
        if (!alive) return;
        // قيد المراجعة لا يُعدَّل، والمعتمد يعدّل ملفه من لوحته
        if (v.status !== 'pending' && v.status !== 'rejected') {
          router.replace(v.status === 'in_review' ? '/vendor/onboarding/status' : '/vendor/store');
          return;
        }
        draftReady.current = true;
        setExisting(v);
        setForm({
          nameAr: v.nameAr,
          nameEn: v.nameEn ?? '',
          slug: v.slug,
          country: v.country,
          businessType: v.businessType ?? 'individual',
        });
        setSlugTouched(true);
      })
      // 404 = لا متجر بعد: تسجيل جديد، بما كُتب قبل التحويل إلى الدخول إن وُجد
      .catch(() => {
        if (!alive) return;
        draftReady.current = true;
        const draft = readDraft();
        if (draft) {
          setForm({ ...BLANK, ...draft.form });
          setSlugTouched(draft.slugTouched);
        }
      });
    return () => {
      alive = false;
    };
    // الدخول من تبويب آخر يقلب signedIn فيُعاد الفحص — متجر قائم يُحوَّل كما لو دخل هنا
  }, [router, signedIn]);

  useEffect(() => {
    if (!draftReady.current || existing) return;
    const blank = !form.nameAr.trim() && !form.nameEn.trim() && !form.slug.trim();
    writeDraft(blank ? null : { form, slugTouched });
  }, [form, slugTouched, existing]);

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
      // رابط المتجر نفسه ليس محجوزاً لغيره
      if (existingSlug && candidate.trim() === existingSlug) {
        setCheck({ slug: existingSlug, available: true, suggestion: existingSlug });
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
  }, [candidate, existingSlug]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await api<Onboarding>('/vendor/onboarding/shop', {
          method: 'PATCH',
          body: {
            nameAr: form.nameAr,
            nameEn: form.nameEn || null,
            ...(check?.slug && check.slug !== existing.slug ? { slug: check.slug } : {}),
            country: form.country,
            businessType: form.businessType,
          },
        });
        // من اختار عملته يكمل إلى المستندات؛ ومن لم يختر يمرّ بها أولاً
        router.push(existing.settlementCurrencyChosen ? '/vendor/onboarding/documents' : '/vendor/onboarding/currency');
        return;
      }
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
      writeDraft(null);
      // العملة قبل المستندات: الاعتماد يثبّتها، فتُختار قبل أن يُرسل الطلب
      router.push('/vendor/onboarding/currency');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        writeDraft({ form, slugTouched });
        router.push(withNext('/login', '/vendor/register'));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : existing
            ? t('تعذّر حفظ بيانات المتجر.', "Couldn't save the shop details.")
            : t('تعذّر تسجيل المتجر.', "Couldn't register the shop."),
      );
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
      ? t('الرابط متاح.', 'The link is available.')
      : slugState === 'checking'
        ? t('نتحقّق من توفّر الرابط…', 'Checking the link is available…')
        : t('يُشتقّ من الاسم الإنجليزي، وتستطيع تغييره.', 'Made from the English name, and you can change it.');
  const slugError =
    slugState === 'taken' ? t('الرابط محجوز لمتجر آخر — اختر رابطاً غيره.', 'This link is taken by another shop — choose a different one.') : null;
  const slugValue = slugTouched ? form.slug : (check?.slug ?? '');

  if (!signedIn) {
    return (
      <OnboardingFrame step={1}>
        <OnboardingHead
          title={t('سجّل متجرك على بسطة', 'Register your shop on Basta')}
          lead={t(
            'متجرك يُربط بحسابك في بسطة — أنشئه أو ادخل، ثم نعود بك إلى هنا لبيانات المتجر.',
            "Your shop is linked to your Basta account — create one or sign in, and we'll bring you back here for your shop details.",
          )}
        />
        <section className="card vo-gate">
          <h2 className="vo-card-title">{t('ابدأ بحسابك', 'Start with your account')}</h2>
          <p className="vo-note__text">
            {t(
              'بالحساب تتابع طلب متجرك، وتصلك نتيجة المراجعة على بريدك، وتدخل لوحتك بعدها.',
              'With an account you can follow your shop application, get the review result by email, and then sign in to your dashboard.',
            )}
          </p>
          <div className="vo-actions">
            <Link className="btn btn--primary" href={withNext('/register', '/vendor/register')}>
              {t('أنشئ حساباً', 'Create an account')}
            </Link>
            <Link className="btn btn--secondary" href={withNext('/login', '/vendor/register')}>
              {t('لديّ حساب — ادخل', 'I have an account — sign in')}
            </Link>
          </div>
        </section>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame step={2}>
      <OnboardingHead
        title={existing ? t('بيانات متجرك', 'Your shop details') : t('سجّل متجرك على بسطة', 'Register your shop on Basta')}
        lead={
          existing
            ? t('عدّل ما تريد ثم تابع. ما رفعته من المستندات محفوظ.', 'Change what you need, then continue. Documents you uploaded are kept.')
            : t(
                'بيانات متجرك الأساسية أولاً، ثم عملة التسوية، ثم المستندات.',
                'Your basic shop details first, then the settlement currency, then the documents.',
              )
        }
      />

      <div className="vo-split">
        <section className="card">
          <h2 className="vo-card-title">{t('بيانات المتجر', 'Shop details')}</h2>

          <form className="vo-form" onSubmit={submit} noValidate>
            {error ? <Alert tone="danger">{error}</Alert> : null}

            <div className="grid-2">
              <TextInput
                label={t('اسم المتجر بالعربية', 'Shop name in Arabic')}
                required
                maxLength={80}
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />

              <TextInput
                label={t('اسم المتجر بالإنجليزية', 'Shop name in English')}
                optional
                dir="ltr"
                maxLength={80}
                hint={t('يُولَّد رابط المتجر تلقائياً من الاسم الإنجليزي.', 'The shop link is generated automatically from the English name.')}
                value={form.nameEn}
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
              />
            </div>

            <div className="vo-slug-field" data-state={slugState}>
              <Field label={t('رابط المتجر', 'Shop link')} hint={slugHint} error={slugError}>
                {(props) => (
                  <span className="vo-slug" dir="ltr" data-state={slugState}>
                    <span className="vo-slug__prefix" aria-hidden>
                      basta.com/s/
                    </span>
                    <ClearableInput
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
                {t('استخدم', 'Use')} <span className="num">{check.suggestion}</span>
              </button>
            ) : null}

            <Field label={t('البلد', 'Country')}>
              {(props) => (
                <select
                  className="field__control"
                  {...props}
                  value={form.country}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {locale === 'en' ? c.nameEn : c.nameAr}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <fieldset className="vo-choices">
              <legend>{t('نوع النشاط', 'Business type')}</legend>
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
                      {t(b.label, b.labelEn)}
                    </span>
                    <span className="vo-radio__hint">{t(b.hint, b.hintEn)}</span>
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
                {busy
                  ? existing
                    ? t('جارٍ الحفظ…', 'Saving…')
                    : t('جارٍ التسجيل…', 'Registering…')
                  : existing?.settlementCurrencyChosen
                    ? t('التالي: المستندات', 'Next: documents')
                    : t('التالي: عملة التسوية', 'Next: settlement currency')}
                {busy ? null : <Icon name="next" size={16} mirror />}
              </button>
            </div>
          </form>
        </section>

        <aside className="vo-col">
          <section className="card">
            <h3 className="vo-side-title">{t('معاينة رابط المتجر', 'Shop link preview')}</h3>
            <div className="vo-urlbox">
              <span className="vo-urlbox__url" dir="ltr">
                basta.com/s/{slugValue || '…'}
              </span>
              <span className="vo-shopline">
                <span className="vo-shopline__icon" aria-hidden>
                  <Icon name="store" size={20} />
                </span>
                <span className="vo-shopline__text">
                  <span className="vo-shopline__name">{form.nameAr || t('اسم متجرك', 'Your shop name')}</span>
                  {form.nameEn ? (
                    <span className="vo-shopline__en" dir="ltr">
                      {form.nameEn}
                    </span>
                  ) : null}
                </span>
              </span>
            </div>
            <div className="vo-note">
              <span className="vo-note__title">{t('الرابط لا يتغيّر بسهولة', "The link isn't easy to change")}</span>
              <span className="vo-note__text">
                {t(
                  'تغييره بعد النشر يكسر الروابط المحفوظة عند المشترين، لذا اخترْه بعناية الآن.',
                  'Changing it after publishing breaks links buyers have saved, so choose it carefully now.',
                )}
              </span>
            </div>
          </section>

          <section className="card">
            <h3 className="vo-side-title">{t('ما تحتاجه للتسجيل', 'What you need to register')}</h3>
            <ul className="vo-checklist">
              <li>
                <Icon name="check-circle" size={16} />
                {t('سجل تجاري ساري وهوية صاحب النشاط', "A valid commercial register and the business owner's ID")}
              </li>
              <li>
                <Icon name="check-circle" size={16} />
                {t('شهادة ضريبية وحساب بنكي باسم النشاط', 'A tax certificate and a bank account in the business name')}
              </li>
              <li>
                <Icon name="check-circle" size={16} />
                {t('تستطيع الحفظ والعودة لاحقاً — كل مستند يُحفظ فور رفعه', 'You can save and come back later — each document is saved as soon as it is uploaded')}
              </li>
            </ul>
            <p className="vo-callout vo-callout--info">
              <Icon name="info" size={16} />
              <span>
                {t(
                  'تُراجَع المستندات خلال يوم عمل إلى ثلاثة أيام، وتصلك النتيجة على بريدك.',
                  "Documents are reviewed within one to three working days, and you'll get the result by email.",
                )}
              </span>
            </p>
          </section>
        </aside>
      </div>
    </OnboardingFrame>
  );
}
