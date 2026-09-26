'use client';

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { Icon, type IconName } from '@/components/icons';

/**
 * المكوّنات المشتركة — تقابل ورقة المكوّنات في `docs/02-design/screens`.
 * كل شيء هنا يقرأ أصنافاً من `globals.css` التي تقرأ الرموز: لا لون ولا مقاس
 * مكتوب في مكوّن (DESIGN-SYSTEM §0).
 */

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  id,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  optional?: boolean | undefined;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string }) => ReactNode;
  id?: string | undefined;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = `${fieldId}-help`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
        {optional ? <span className="field__optional"> · اختياري</span> : null}
      </label>
      {children({ id: fieldId, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {/* الخطأ يحلّ محلّ التلميح لا يُضاف إليه: سطران متناقضان يربكان */}
      {error ? (
        <p className="field__error" id={describedBy} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={describedBy}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  hint,
  error,
  optional,
  id,
  ...input
}: {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  optional?: boolean | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  /**
   * المعرّف يُمرَّر إلى `Field` لا إلى الحقل مباشرةً. حين مُرِّر إلى الاثنين
   * صار `htmlFor` يشير إلى معرّف مولَّد والحقل يحمل معرّفاً آخر، فانقطع
   * الارتباط: النقر على التسمية لا يركّز، وقارئ الشاشة يقرأ حقلاً بلا اسم.
   */
  return (
    <Field label={label} hint={hint} error={error} optional={optional} id={id}>
      {(props) => <input className="field__control" {...props} {...input} />}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  optional,
  id,
  ...area
}: {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  optional?: boolean | undefined;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} id={id}>
      {(props) => <textarea className="field__control" {...props} {...area} />}
    </Field>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'danger' | 'warning' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title ? <p className="alert__title">{title}</p> : null}
      {children}
    </div>
  );
}

export function Card({
  title,
  aside,
  hint,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <header className="card__title">
          <h2>{title}</h2>
          {aside}
        </header>
      ) : null}
      {hint ? <p className="card__hint">{hint}</p> : null}
      {children}
    </section>
  );
}

const STEPS = ['الحساب', 'المتجر', 'الوثائق', 'المراجعة'] as const;
export type StepName = (typeof STEPS)[number];

/** شريط الخطوات في VD-01 → VD-03. الخطوة الحالية وحدها ملوّنة بالعلامة. */
export function Stepper({ current }: { current: StepName }) {
  const index = STEPS.indexOf(current);
  return (
    <ol className="stepper" aria-label="خطوات التسجيل">
      {STEPS.map((step, i) => (
        <li
          key={step}
          className="stepper__item"
          data-state={i < index ? 'done' : i === index ? 'current' : 'todo'}
          {...(i === index ? { 'aria-current': 'step' as const } : {})}
        >
          <span className="stepper__dot" aria-hidden>
            {i < index ? '✓' : i + 1}
          </span>
          {step}
          {i < STEPS.length - 1 ? <span className="stepper__sep" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

const STATUS_TONE: Record<string, string> = {
  pending: 'badge--pending',
  in_review: 'badge--review',
  approved: 'badge--approved',
  rejected: 'badge--rejected',
  suspended: 'badge--warning',
  banned: 'badge--rejected',
  missing: 'badge--pending',
  accepted: 'badge--approved',
};

/**
 * `pending` تعني شيئين مختلفين: متجر لم يُرسل طلبه بعد، ووثيقة رُفعت وتنتظر
 * المراجعة. جدول واحد كان يسمّي الوثيقة المرفوعة «مسوّدة» — فصل الجدولين
 * ليس ترفاً لغوياً: الكلمة الخطأ هنا تجعل البائع يظنّ أن رفعه لم ينجح.
 */
const VENDOR_LABEL: Record<string, string> = {
  pending: 'مسوّدة',
  in_review: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  suspended: 'معلَّق',
  banned: 'محظور',
};

const DOCUMENT_LABEL: Record<string, string> = {
  missing: 'لم تُرفع',
  pending: 'بانتظار المراجعة',
  accepted: 'مقبولة',
  rejected: 'مرفوضة',
};

export function StatusBadge({
  status,
  kind = 'vendor',
}: {
  status: string;
  kind?: 'vendor' | 'document';
}) {
  const label = kind === 'document' ? DOCUMENT_LABEL[status] : VENDOR_LABEL[status];
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}>{label ?? status}</span>;
}

export interface Blocker {
  code: string;
  message: string;
  field: string;
}

/**
 * قائمة الموانع مجتمعة — لا مانعاً واحداً في كل محاولة.
 * كل سطر يقود إلى حقله، وإلا صارت القائمة تقريراً لا أداة إصلاح.
 */
export function BlockerList({
  blockers,
  onGo,
}: {
  blockers: readonly Blocker[];
  onGo?: (field: string) => void;
}) {
  if (blockers.length === 0) return null;
  return (
    // العدد لا يُدمج في الجملة: تمييز العدد في العربية يتغيّر بتغيّره
    // (عنصر واحد · عنصران · 4 عناصر · 11 عنصراً)، وجملة واحدة لا تصحّ لكلها.
    <Alert tone="warning" title="ما زال ينقص طلبك">
      <ul className="blockers">
        {blockers.map((b) => (
          <li key={b.code} className="blockers__item">
            <span aria-hidden>•</span>
            {onGo ? (
              <button type="button" className="blockers__link" onClick={() => onGo(b.field)}>
                {b.message}
              </button>
            ) : (
              <span>{b.message}</span>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export function Spinner({ label = 'جارٍ التحميل' }: { label?: string }) {
  return (
    <p className="row muted small">
      <span className="spinner" aria-hidden />
      {label}
    </p>
  );
}

/**
 * رأس الصفحة — نمط كل شاشة في التصميم: العنوان، وعدّاد أو وصف قصير بجانبه،
 * والإجراءات في الطرف المقابل.
 */
export function PageHead({
  title,
  meta,
  count,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {count !== undefined && count !== null ? <span className="page-head__count">{count}</span> : null}
      {meta ? <span className="page-head__meta">{meta}</span> : null}
      {actions ? <span className="page-head__actions">{actions}</span> : null}
    </div>
  );
}

/**
 * حالة فارغة — مربّع أيقونة وعنوان وجملة تقول ما التالي وإجراؤه،
 * لا «لا يوجد» وحدها.
 */
export function EmptyState({
  icon = 'package',
  title,
  children,
  actions,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden>
        <Icon name={icon} size={28} />
      </span>
      <p className="empty__title">{title}</p>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
