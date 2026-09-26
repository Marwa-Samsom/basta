'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, StatusBadge, TextInput, type Blocker } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useOnboarding, type Onboarding, type OnboardingDocument } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';

/** ما يُطلب في كل مستند — تحت عنوانه وداخل منطقة الإسقاط */
const DOC_HINT: Record<string, string> = {
  commercial_register: 'PDF أو صورة · حتى 10 ميغابايت',
  national_id: 'صورة واضحة للوجهين · حتى 10 ميغابايت',
  tax_card: 'PDF أو صورة · حتى 10 ميغابايت',
  bank_proof: 'كشف حساب يُظهر الاسم والآيبان',
};

/**
 * VD-02 — الوثائق والحساب البنكي.
 *
 * الموانع تُعرض مجتمعة في لوحة واحدة مع زر الإرسال، وكل مانع يقود إلى
 * بطاقته أو حقله. البائع الذي يُقال له «ينقصك الهوية» ثم «ينقصك السجل» بعد
 * كل رفع يهجر التسجيل.
 */
export default function DocumentsPage() {
  const router = useRouter();
  const { data, loading, missing, error, set, reload } = useOnboarding();
  const [notice, setNotice] = useState<string | null>(null);

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <OnboardingFrame step={3}>
        <OnboardingLoading />
      </OnboardingFrame>
    );
  }
  if (error || !data) {
    return (
      <OnboardingFrame step={3}>
        <OnboardingError message={error ?? 'تعذّر تحميل حالة المتجر.'} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  const frozen = data.status === 'in_review';

  /** اسم وجهة المانع كما يقرؤه البائع — لا مسار الحقل التقني */
  function targetLabel(field: string): string {
    if (field.startsWith('documents.')) {
      const type = field.slice('documents.'.length);
      return data?.documents.find((d) => d.type === type)?.label ?? 'المستند';
    }
    if (field.startsWith('bank.')) return 'الحساب البنكي';
    return 'بيانات المتجر';
  }

  return (
    <OnboardingFrame step={3} status={data.status}>
      <OnboardingHead
        title="ارفع مستندات المتجر"
        lead="أربعة مستندات وحساب بنكي باسم النشاط. الصيغ المقبولة PDF أو صورة JPEG أو PNG، حتى 10 ميغابايت للملف."
      />
      <p className="vo-ident">
        {data.nameAr} · <span className="num">basta.com/s/{data.slug}</span>
      </p>

      {frozen ? (
        <Alert tone="info" title="طلبك قيد المراجعة">
          لا يقبل التعديل الآن. تصلك النتيجة على بريدك، وتستطيع متابعة الحالة في أي وقت.
        </Alert>
      ) : null}

      {data.status === 'rejected' && data.rejectionReason ? (
        <Alert tone="danger" title="طلبك مرفوض">
          {data.rejectionReason}
        </Alert>
      ) : null}

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="vo-docs">
        {data.documents.map((doc) => (
          <DocumentCard
            key={doc.type}
            doc={doc}
            disabled={frozen}
            onUploaded={(next) => {
              set(next);
              setNotice(`رُفعت ${doc.label}.`);
            }}
          />
        ))}
      </div>

      <BankCard vendor={data} disabled={frozen} onSaved={set} />

      <SubmitGate
        vendor={data}
        onSubmitted={set}
        targetLabel={targetLabel}
        onBack={() => router.push('/vendor/register')}
        onGo={(field) => {
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
      setError(err instanceof ApiError ? err.message : 'تعذّر رفع الملف.');
    } finally {
      setBusy(false);
      setUploadingName(null);
    }
  }

  const hint = DOC_HINT[doc.type] ?? 'PDF أو صورة · حتى 10 ميغابايت';
  const isPdf = (doc.originalName ?? '').toLowerCase().endsWith('.pdf');

  return (
    <section
      className="card vo-doc"
      id={`documents-${doc.type}`}
      tabIndex={-1}
      aria-label={doc.label}
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
          <span className="vo-doc__title">{doc.label}</span>
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
            <span>جارٍ الرفع…</span>
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
              <bdi>{doc.originalName ?? 'ملف مرفوع'}</bdi>
            </span>
            {doc.sizeBytes ? (
              <span className="vo-file__size">
                <span className="num">{Math.ceil(doc.sizeBytes / 1024)}</span> كيلوبايت
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            استبدل
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
          <span className="vo-drop__title">اسحب الملف هنا أو اختر ملفاً</span>
          <span className="vo-drop__hint">{hint}</span>
        </button>
      )}

      {doc.status === 'rejected' && doc.rejectReason ? (
        <p className="vo-reason">
          <Icon name="alert" size={15} />
          <span>{doc.rejectReason} — ارفعها من جديد.</span>
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {doc.downloadPath ? (
        <p className="vo-doc__foot">تستطيع تنزيل الملف من صفحة الحالة.</p>
      ) : null}

      <input
        ref={input}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-label={`ملف ${doc.label}`}
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
      setError(err instanceof Error ? err.message : 'تعذّر حفظ الحساب البنكي.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="bank" aria-labelledby="bank-title">
      <div className="vo-card-head">
        <h2 className="vo-card-title" id="bank-title">
          الحساب البنكي
        </h2>
        <p className="vo-card-sub">
          يجب أن يكون الحساب باسم النشاط نفسه المذكور في السجل التجاري، وإليه يُحوَّل رصيدك بعد كل تسوية.
        </p>
      </div>
      <form className="vo-form" onSubmit={save} noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {saved && !error ? <Alert tone="success">حُفظ الحساب البنكي.</Alert> : null}

        <div className="grid-2">
          <TextInput
            label="اسم صاحب الحساب"
            id="bank-holderName"
            hint="كما هو مكتوب لدى البنك."
            disabled={disabled}
            required
            value={form.holderName}
            onChange={(e) => setForm((f) => ({ ...f, holderName: e.target.value }))}
          />

          {/* الآيبان لاتيني داخل واجهة عربية — يُعزل وإلا انقلب ترتيب خاناته */}
          <TextInput
            label="رقم الآيبان"
            id="bank-iban"
            dir="ltr"
            className="field__control num vo-iban"
            disabled={disabled}
            required
            value={form.iban}
            onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value.toUpperCase() }))}
          />

          <TextInput
            label="البنك"
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
            {busy ? 'جارٍ الحفظ…' : 'حفظ الحساب'}
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
      setError(err instanceof Error ? err.message : 'تعذّر إرسال الطلب.');
    } finally {
      setBusy(false);
    }
  }

  const blockers: readonly Blocker[] = vendor.blockers;
  const tone = blockers.length > 0 ? 'danger' : vendor.canSubmit ? 'success' : 'neutral';

  return (
    <section className="vo-gate" data-tone={tone} aria-label="إرسال الطلب">
      {tone !== 'neutral' ? (
        <div className="vo-gate__head">
          <Icon name={tone === 'danger' ? 'alert' : 'check-circle'} size={18} />
          <span>{tone === 'danger' ? 'لا يمكن الإرسال بعد' : 'كل المستندات جاهزة للإرسال'}</span>
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
          title={vendor.canSubmit ? undefined : 'أكمل النواقص المعروضة أعلاه'}
        >
          {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
          {busy ? 'جارٍ الإرسال…' : 'أرسل للمراجعة'}
        </button>
        <button className="btn btn--secondary" type="button" onClick={onBack}>
          <Icon name="back" size={16} mirror />
          رجوع
        </button>
        <span className="vo-gate__hint">
          {blockers.length > 0
            ? 'أصلح العوائق كلها ليُفتح الإرسال.'
            : 'المراجعة تستغرق يوم عمل إلى ثلاثة أيام، وتصلك النتيجة على بريدك.'}
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
