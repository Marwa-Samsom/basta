'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, StatusBadge, TextInput, type Blocker } from '@/components/ui';
import { Icon } from '@/components/icons';
import { CURRENCIES, useOnboarding, type Onboarding, type OnboardingDocument } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';
import { useLocale, useT } from '@/components/locale';
import type { Locale } from '@/lib/i18n';

/** ما يُطلب في كل مستند — تحت عنوانه وداخل منطقة الإسقاط */
const DOC_HINT: Record<string, string> = {
  commercial_register: 'PDF أو صورة · حتى 10 ميغابايت',
  national_id: 'صورة واضحة للوجهين · حتى 10 ميغابايت',
  tax_card: 'PDF أو صورة · حتى 10 ميغابايت',
  bank_proof: 'كشف حساب يُظهر الاسم والآيبان',
};
const DOC_HINT_EN: Record<string, string> = {
  commercial_register: 'PDF or image · up to 10 MB',
  national_id: 'A clear image of both sides · up to 10 MB',
  tax_card: 'PDF or image · up to 10 MB',
  bank_proof: 'A statement showing the name and IBAN',
};
/** أسماء المستندات بالإنجليزية — الخادم يرسل الاسم بالعربية وحدها، فيُقرأ بالنوع */
const DOC_LABEL_EN: Record<string, string> = {
  commercial_register: 'Commercial register',
  national_id: 'National ID',
  tax_card: 'Tax certificate',
  bank_proof: 'Bank account proof',
};
const docLabel = (doc: Pick<OnboardingDocument, 'type' | 'label'>, locale: Locale): string =>
  locale === 'en' ? (DOC_LABEL_EN[doc.type] ?? doc.label) : doc.label;

/**
 * VD-02 — الوثائق والحساب البنكي.
 *
 * الموانع تُعرض مجتمعة في لوحة واحدة مع زر الإرسال، وكل مانع يقود إلى
 * بطاقته أو حقله. البائع الذي يُقال له «ينقصك الهوية» ثم «ينقصك السجل» بعد
 * كل رفع يهجر التسجيل.
 */
export default function DocumentsPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, loading, missing, error, set, reload } = useOnboarding();
  const [notice, setNotice] = useState<string | null>(null);

  // التحويل إلى التسجيل في useOnboarding نفسه، بعد الرسم
  if (missing) return null;
  if (loading && !data) {
    return (
      <OnboardingFrame step={4}>
        <OnboardingLoading />
      </OnboardingFrame>
    );
  }
  if (error || !data) {
    return (
      <OnboardingFrame step={4}>
        <OnboardingError message={error ?? t('تعذّر تحميل حالة المتجر.', "Couldn't load your shop status.")} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  // المسوّدة والمرفوض وحدهما يُعدَّلان — والخادم يرفض ما عداهما
  const frozen = data.status !== 'pending' && data.status !== 'rejected';
  // وأثناء المراجعة تُستبدل الوثيقة المرفوضة وحدها، فتعود إلى المراجعة (ADM-030)
  const replaceable = (doc: OnboardingDocument) => !frozen || (data.status === 'in_review' && doc.status === 'rejected');
  const anyRejected = data.documents.some((d) => d.status === 'rejected');

  /** اسم وجهة المانع كما يقرؤه البائع — لا مسار الحقل التقني */
  function targetLabel(field: string): string {
    if (field.startsWith('documents.')) {
      const type = field.slice('documents.'.length);
      const doc = data?.documents.find((d) => d.type === type);
      return doc ? docLabel(doc, locale) : t('المستند', 'Document');
    }
    if (field.startsWith('bank.')) return t('الحساب البنكي', 'Bank account');
    if (field === 'settlementCurrency') return t('عملة التسوية', 'Settlement currency');
    return t('بيانات المتجر', 'Shop details');
  }

  return (
    <OnboardingFrame step={4} status={data.status}>
      <OnboardingHead
        title={t('ارفع مستندات المتجر', 'Upload your shop documents')}
        lead={t(
          'أربعة مستندات وحساب بنكي باسم النشاط. الصيغ المقبولة PDF أو صورة JPEG أو PNG، حتى 10 ميغابايت للملف.',
          'Four documents and a bank account in the business name. Accepted formats are PDF or a JPEG or PNG image, up to 10 MB per file.',
        )}
      />
      <p className="vo-ident">
        {locale === 'en' && data.nameEn ? data.nameEn : data.nameAr} · <span className="num">basta.com/s/{data.slug}</span> ·{' '}
        {t('عملة التسوية:', 'Settlement currency:')}{' '}
        {data.settlementCurrencyChosen ? (
          <>
            {(() => {
              const c = CURRENCIES.find((x) => x.code === data.settlementCurrency);
              return (locale === 'en' ? c?.nameEn : c?.nameAr) ?? data.settlementCurrency;
            })()}
            {data.settlementCurrencyLocked ? null : (
              <>
                {' '}
                <Link href="/vendor/onboarding/currency">{t('غيّرها', 'Change it')}</Link>
              </>
            )}
          </>
        ) : (
          <Link href="/vendor/onboarding/currency">{t('لم تخترها بعد — اخترها', 'Not chosen yet — choose it')}</Link>
        )}
        {/* لا طريق آخر إلى صفحة الحالة من هنا — خطوات الشريط لا تُكبس (VON-041) */}
        {' · '}
        <Link href="/vendor/onboarding/status">{t('تابع حالة طلبك', 'Track your application')}</Link>
      </p>

      {data.status === 'in_review' ? (
        <Alert tone="info" title={t('طلبك قيد المراجعة', 'Your application is under review')}>
          {anyRejected
            ? t(
                'لا يقبل التعديل الآن إلا المستند المرفوض: ارفعه من جديد فيعود إلى المراجعة، وطلبك باقٍ في مكانه.',
                'Only the rejected document can be changed now: upload it again and it goes back to review, while your application keeps its place.',
              )
            : t(
                'لا يقبل التعديل الآن. تصلك النتيجة على بريدك، وتستطيع متابعة الحالة في أي وقت.',
                "It can't be edited now. You'll get the result by email, and you can check the status at any time.",
              )}
        </Alert>
      ) : data.status === 'approved' ? (
        <Alert tone="info" title={t('متجرك معتمد', 'Your shop is approved')}>
          {t(
            'المستندات مثبّتة كما رُوجعت، ولتغييرها راسل الدعم. الحساب البنكي يُضاف من',
            'Documents are locked as reviewed; to change them, contact support. Bank accounts are added from',
          )}{' '}
          <Link href="/vendor/settings">{t('الإعدادات', 'Settings')}</Link>{' '}
          {t('بتأكيد كلمة المرور وتوثيق من فريق بسطة.', 'with your password and verification by the Basta team.')}
        </Alert>
      ) : frozen ? (
        <Alert tone="warning" title={t('حساب المتجر موقوف', 'Shop account suspended')}>
          {t('لا يقبل التعديل. راسل الدعم.', "It can't be edited. Contact support.")}
        </Alert>
      ) : null}

      {data.status === 'rejected' && data.rejectionReason ? (
        <Alert tone="danger" title={t('طلبك مرفوض', 'Your application was rejected')}>
          {data.rejectionReason}
        </Alert>
      ) : null}

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="vo-docs">
        {data.documents.map((doc) => (
          <DocumentCard
            key={doc.type}
            doc={doc}
            disabled={!replaceable(doc)}
            onUploaded={(next) => {
              set(next);
              setNotice(t(`رُفعت ${doc.label}.`, `${docLabel(doc, locale)} uploaded.`));
            }}
          />
        ))}
      </div>

      <BankCard vendor={data} disabled={frozen} onSaved={set} />

      <SubmitGate
        vendor={data}
        onSubmitted={set}
        targetLabel={targetLabel}
        onBack={() => router.push('/vendor/onboarding/currency')}
        onGo={(field) => {
          // الاسمان في بيانات المتجر — ومسوّدة قبل 3 نوفمبر بلا اسم إنجليزي يوقفها مانعه
          if (field === 'nameAr' || field === 'nameEn') {
            router.push('/vendor/register');
            return;
          }
          // العملة في خطوتها لا في هذه الصفحة
          if (field === 'settlementCurrency') {
            router.push('/vendor/onboarding/currency');
            return;
          }
          const target = document.getElementById(field.replaceAll('.', '-'));
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target?.focus({ preventScroll: true });
        }}
      />
    </OnboardingFrame>
  );
}

function DocumentCard({
  doc,
  disabled,
  onUploaded,
}: {
  doc: OnboardingDocument;
  disabled: boolean;
  onUploaded: (next: Onboarding) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const label = docLabel(doc, locale);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setUploadingName(file.name);
    setError(null);
    try {
      onUploaded(
        await api<Onboarding>(`/vendor/onboarding/documents/${doc.type}`, { method: 'POST', file }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('تعذّر رفع الملف.', "Couldn't upload the file."));
    } finally {
      setBusy(false);
      setUploadingName(null);
    }
  }

  const hint =
    (locale === 'en' ? DOC_HINT_EN[doc.type] : DOC_HINT[doc.type]) ?? t('PDF أو صورة · حتى 10 ميغابايت', 'PDF or image · up to 10 MB');
  const isPdf = (doc.originalName ?? '').toLowerCase().endsWith('.pdf');

  return (
    <section
      className="card vo-doc"
      id={`documents-${doc.type}`}
      tabIndex={-1}
      aria-label={label}
      data-status={doc.status}
      data-dragging={dragging}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !disabled) void upload(file);
      }}
    >
      <div className="vo-doc__head">
        <span className="vo-doc__icon" aria-hidden>
          <Icon name="file" size={18} />
        </span>
        <span className="vo-doc__titles">
          <span className="vo-doc__title">{label}</span>
          <span className="vo-doc__hint">{hint}</span>
        </span>
        <StatusBadge status={doc.status} kind="document" />
      </div>

      {busy ? (
        <div className="vo-uploading" role="status">
          <span className="vo-uploading__row">
            <span className="vo-file__name">
              <bdi>{uploadingName}</bdi>
            </span>
            <span>{t('جارٍ الرفع…', 'Uploading…')}</span>
          </span>
          <span className="vo-bar" aria-hidden />
        </div>
      ) : doc.uploaded ? (
        <div className="vo-file">
          <span className="vo-file__icon" aria-hidden>
            <Icon name={isPdf ? 'file' : 'image'} size={16} />
          </span>
          <span className="vo-file__text">
            <span className="vo-file__name">
              <bdi>{doc.originalName ?? t('ملف مرفوع', 'Uploaded file')}</bdi>
            </span>
            {doc.sizeBytes ? (
              <span className="vo-file__size">
                <span className="num">{Math.ceil(doc.sizeBytes / 1024)}</span> {t('كيلوبايت', 'KB')}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            {t('استبدل', 'Replace')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="vo-drop"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <Icon name="upload" size={22} />
          <span className="vo-drop__title">{t('اسحب الملف هنا أو اختر ملفاً', 'Drag the file here or choose a file')}</span>
          <span className="vo-drop__hint">{hint}</span>
        </button>
      )}

      {doc.status === 'rejected' && doc.rejectReason ? (
        <p className="vo-reason">
          <Icon name="alert" size={15} />
          <span>
            {doc.rejectReason} {t('— ارفعها من جديد.', '— upload it again.')}
          </span>
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {doc.downloadPath ? (
        <p className="vo-doc__foot">{t('تستطيع تنزيل الملف من صفحة الحالة.', 'You can download the file from the status page.')}</p>
      ) : null}

      <input
        ref={input}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-label={t(`ملف ${doc.label}`, `${label} file`)}
        accept="application/pdf,image/jpeg,image/png"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
    </section>
  );
}

function BankCard({
  vendor,
  disabled,
  onSaved,
}: {
  vendor: Onboarding;
  disabled: boolean;
  onSaved: (next: Onboarding) => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    holderName: vendor.bank?.holderName ?? '',
    iban: vendor.bank?.iban ?? '',
    bankName: vendor.bank?.bankName ?? '',
    swift: vendor.bank?.swift ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<Onboarding>('/vendor/onboarding/bank', {
          method: 'PUT',
          body: {
            holderName: form.holderName,
            iban: form.iban.replace(/\s/g, ''),
            bankName: form.bankName,
            ...(form.swift ? { swift: form.swift } : {}),
          },
        }),
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّر حفظ الحساب البنكي.', "Couldn't save the bank account."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="bank" aria-labelledby="bank-title">
      <div className="vo-card-head">
        <h2 className="vo-card-title" id="bank-title">
          {t('الحساب البنكي', 'Bank account')}
        </h2>
        <p className="vo-card-sub">
          {t(
            'يجب أن يكون الحساب باسم النشاط نفسه المذكور في السجل التجاري، وإليه يُحوَّل رصيدك بعد كل تسوية.',
            'The account must be in the same business name as on the commercial register; your balance is paid out to it after each settlement.',
          )}
        </p>
      </div>
      <form className="vo-form" onSubmit={save} noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {saved && !error ? <Alert tone="success">{t('حُفظ الحساب البنكي.', 'Bank account saved.')}</Alert> : null}

        <div className="grid-2">
          <TextInput
            label={t('اسم صاحب الحساب', 'Account holder name')}
            id="bank-holderName"
            hint={t('كما هو مكتوب لدى البنك.', 'As written at the bank.')}
            disabled={disabled}
            required
            value={form.holderName}
            onChange={(e) => setForm((f) => ({ ...f, holderName: e.target.value }))}
          />

          {/* الآيبان لاتيني داخل واجهة عربية — يُعزل وإلا انقلب ترتيب خاناته */}
          <TextInput
            label={t('رقم الآيبان', 'IBAN')}
            id="bank-iban"
            dir="ltr"
            className="field__control num vo-iban"
            disabled={disabled}
            required
            value={form.iban}
            onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value.toUpperCase() }))}
          />

          <TextInput
            label={t('البنك', 'Bank')}
            disabled={disabled}
            required
            value={form.bankName}
            onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
          />
          <TextInput
            label="SWIFT / BIC"
            optional
            dir="ltr"
            className="field__control num"
            disabled={disabled}
            value={form.swift}
            onChange={(e) => setForm((f) => ({ ...f, swift: e.target.value.toUpperCase() }))}
          />
        </div>

        <div className="vo-actions">
          <button className="btn btn--secondary" type="submit" disabled={disabled || busy}>
            {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
            {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ الحساب', 'Save account')}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * لوحة الإرسال: الموانع كلها مع زرّ الإرسال في مكان واحد. العدد في شارة
 * منفصلة لا داخل الجملة — تمييز العدد في العربية يتغيّر بتغيّره.
 */
function SubmitGate({
  vendor,
  onSubmitted,
  onGo,
  onBack,
  targetLabel,
}: {
  vendor: Onboarding;
  onSubmitted: (next: Onboarding) => void;
  onGo: (field: string) => void;
  onBack: () => void;
  targetLabel: (field: string) => string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onSubmitted(await api<Onboarding>('/vendor/onboarding/submit', { method: 'POST' }));
      router.push('/vendor/onboarding/status');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّر إرسال الطلب.', "Couldn't submit the application."));
    } finally {
      setBusy(false);
    }
  }

  const blockers: readonly Blocker[] = vendor.blockers;
  const tone = blockers.length > 0 ? 'danger' : vendor.canSubmit ? 'success' : 'neutral';

  return (
    <section className="vo-gate" data-tone={tone} aria-label={t('إرسال الطلب', 'Submit application')}>
      {tone !== 'neutral' ? (
        <div className="vo-gate__head">
          <Icon name={tone === 'danger' ? 'alert' : 'check-circle'} size={18} />
          <span>
            {tone === 'danger'
              ? t('لا يمكن الإرسال بعد', "Can't submit yet")
              : t('كل المستندات جاهزة للإرسال', 'All documents are ready to submit')}
          </span>
          {tone === 'danger' ? <span className="vo-gate__count num">{blockers.length}</span> : null}
        </div>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="vo-gate__list">
          {blockers.map((b) => (
            <li key={b.code} className="vo-gate__item">
              <span className="vo-gate__mark" aria-hidden>
                <Icon name="alert" size={13} />
              </span>
              <span className="vo-gate__text">
                <span className="vo-gate__msg">{b.message}</span>
                <button type="button" className="vo-gate__go" onClick={() => onGo(b.field)}>
                  {targetLabel(b.field)}
                  <Icon name="chev-end" size={12} mirror />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="vo-gate__foot">
        <button
          className="btn btn--primary"
          type="button"
          disabled={!vendor.canSubmit || busy}
          onClick={() => void submit()}
          title={vendor.canSubmit ? undefined : t('أكمل النواقص المعروضة أعلاه', 'Complete the missing items shown above')}
        >
          {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
          {busy ? t('جارٍ الإرسال…', 'Submitting…') : t('أرسل للمراجعة', 'Submit for review')}
        </button>
        <button className="btn btn--secondary" type="button" onClick={onBack}>
          <Icon name="back" size={16} mirror />
          {t('رجوع', 'Back')}
        </button>
        <span className="vo-gate__hint">
          {blockers.length > 0
            ? t('أصلح العوائق كلها ليُفتح الإرسال.', 'Fix all the blockers to enable submitting.')
            : t(
                'المراجعة تستغرق يوم عمل إلى ثلاثة أيام، وتصلك النتيجة على بريدك.',
                "Review takes one to three working days, and you'll get the result by email.",
              )}
        </span>
        {error ? (
          <p className="field__error vo-gate__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
