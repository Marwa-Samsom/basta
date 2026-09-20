'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, BlockerList, Card, Spinner, StatusBadge, TextInput } from '@/components/ui';
import { useOnboarding, type Onboarding, type OnboardingDocument } from '@/lib/vendor';

/**
 * VD-02 — الوثائق والحساب البنكي.
 *
 * الموانع تُعرض مجتمعة فوق، وكل مانع يقود إلى بطاقته أو حقله. البائع الذي
 * يُقال له «ينقصك الهوية» ثم «ينقصك السجل» بعد كل رفع يهجر التسجيل.
 */
export default function DocumentsPage() {
  const router = useRouter();
  const { data, loading, missing, error, set } = useOnboarding();
  const [notice, setNotice] = useState<string | null>(null);

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <main className="shell">
        <Spinner label="جارٍ تحميل حالة متجرك…" />
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

  const frozen = data.status === 'in_review';

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <div className="row row--between">
          <h1>وثائق المتجر</h1>
          <StatusBadge status={data.status} />
        </div>
        <p className="muted">{data.nameAr} · basta.com/s/{data.slug}</p>
      </header>

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

      <BlockerList
        blockers={data.blockers}
        onGo={(field) => {
          const target = document.getElementById(field.replaceAll('.', '-'));
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target?.focus({ preventScroll: true });
        }}
      />

      <Card title="الوثائق المطلوبة" hint="PDF أو صورة JPEG أو PNG، حتى 10 ميغابايت للملف.">
        <div className="stack">
          {data.documents.map((doc) => (
            <DocumentRow
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
      </Card>

      <BankCard vendor={data} disabled={frozen} onSaved={set} />

      <div className="row row--between">
        <button className="btn btn--secondary" type="button" onClick={() => router.push('/vendor/register')}>
          رجوع
        </button>
        <SubmitButton vendor={data} onSubmitted={set} />
      </div>
    </main>
  );
}

function DocumentRow({
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
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onUploaded(
        await api<Onboarding>(`/vendor/onboarding/documents/${doc.type}`, { method: 'POST', file }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر رفع الملف.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dropzone"
      id={`documents-${doc.type}`}
      tabIndex={-1}
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
      <div className="row row--between" style={{ width: '100%' }}>
        <span className="card__title" style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
          {doc.label}
        </span>
        <StatusBadge status={doc.status} kind="document" />
      </div>

      {doc.uploaded ? (
        <p className="small">
          {doc.originalName ?? 'ملف مرفوع'}
          {doc.sizeBytes ? ` · ${Math.ceil(doc.sizeBytes / 1024)} كيلوبايت` : ''}
        </p>
      ) : (
        <p className="small">اسحب الملف إلى هنا أو اختره من جهازك.</p>
      )}

      {doc.status === 'rejected' && doc.rejectReason ? (
        <p className="field__error">{doc.rejectReason} — ارفعها من جديد.</p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      <div className="row">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'جارٍ الرفع…' : doc.uploaded ? 'استبدال الملف' : 'اختر ملفاً'}
        </button>
        {doc.downloadPath ? (
          <span className="small muted">تستطيع تنزيل الملف من صفحة الحالة.</span>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept="application/pdf,image/jpeg,image/png"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
    </div>
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
    <Card title="حساب استلام المستحقات" hint="يُحوَّل إليه رصيدك بعد كل تسوية.">
      <form className="stack" onSubmit={save} noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {saved && !error ? <Alert tone="success">حُفظ الحساب البنكي.</Alert> : null}

        <TextInput
          label="اسم صاحب الحساب"
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
          className="field__control num"
          disabled={disabled}
          required
          value={form.iban}
          onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value.toUpperCase() }))}
        />

        <div className="grid-2">
          <TextInput
            label="اسم البنك"
            disabled={disabled}
            required
            value={form.bankName}
            onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
          />
          <TextInput
            label="سويفت"
            optional
            dir="ltr"
            disabled={disabled}
            value={form.swift}
            onChange={(e) => setForm((f) => ({ ...f, swift: e.target.value.toUpperCase() }))}
          />
        </div>

        <button className="btn btn--secondary" type="submit" disabled={disabled || busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ الحساب'}
        </button>
      </form>
    </Card>
  );
}

function SubmitButton({
  vendor,
  onSubmitted,
}: {
  vendor: Onboarding;
  onSubmitted: (next: Onboarding) => void;
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

  return (
    <div className="stack stack--tight" style={{ alignItems: 'flex-end' }}>
      {error ? <p className="field__error">{error}</p> : null}
      <button
        className="btn btn--primary"
        type="button"
        disabled={!vendor.canSubmit || busy}
        onClick={() => void submit()}
        title={vendor.canSubmit ? undefined : 'أكمل النواقص المعروضة أعلاه'}
      >
        {busy ? 'جارٍ الإرسال…' : 'أرسل للمراجعة'}
      </button>
    </div>
  );
}
