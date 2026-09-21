'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Spinner, TextArea } from './ui';

/** رأس صفحة إدارية بعنوانها وما يقابلها من أزرار */
export function AdminHeader({ title, hint, children }: { title: string; hint?: string | undefined; children?: ReactNode }) {
  return (
    <header className="row row--between">
      <div className="stack stack--tight">
        <h1>{title}</h1>
        {hint ? <p className="small muted">{hint}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </header>
  );
}

/** حالة التحميل والخطأ والمنع بصيغة واحدة في كل صفحة */
export function Loading({ error, forbidden, label }: { error: string | null; forbidden?: boolean; label?: string }) {
  if (forbidden) return <Alert tone="warning">هذه الصفحة تحتاج صلاحية لا يملكها حسابك. {error}</Alert>;
  if (error) return <Alert tone="danger">{error}</Alert>;
  return <Spinner label={label ?? 'جارٍ التحميل…'} />;
}

export function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
    </>
  );
}

/**
 * زرّ بسبب مكتوب — رفض، تعليق، إلغاء. السبب يُعرض للطرف الآخر كما يُكتب،
 * فالحقل يظهر عند الضغط لا نافذة منبثقة تُغلق بالخطأ.
 */
export function ReasonButton({
  label,
  confirmLabel,
  tone = 'danger',
  min = 5,
  hint,
  presets,
  disabled,
  onSubmit,
}: {
  label: string;
  confirmLabel?: string;
  tone?: 'danger' | 'secondary' | 'primary';
  min?: number;
  hint?: string;
  presets?: string[];
  disabled?: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button type="button" className={`btn btn--${tone === 'primary' ? 'primary' : tone === 'secondary' ? 'secondary' : 'danger'} btn--sm`} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="stack card" style={{ minWidth: 'min(28rem, 100%)' }}>
      {presets?.length ? (
        <div className="chips">
          {presets.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => setReason(p)}>
              {p}
            </button>
          ))}
        </div>
      ) : null}
      <TextArea label="السبب" hint={hint ?? 'يُحفظ في السجل ويُعرض لصاحب الشأن كما تكتبه.'} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      <div className="row">
        <button
          type="button"
          className={`btn btn--${tone === 'primary' ? 'primary' : 'danger'} btn--sm`}
          disabled={disabled || reason.trim().length < min}
          onClick={async () => {
            if (await onSubmit(reason.trim())) {
              setOpen(false);
              setReason('');
            }
          }}
        >
          {confirmLabel ?? label}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
          تراجع
        </button>
      </div>
    </div>
  );
}

/** تبويبات فلترة بسيطة */
export function Tabs({ value, options, onChange }: { value: string; options: { key: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.key} type="button" role="tab" className="tabs__tab" aria-selected={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty muted">{children}</p>;
}
