'use client';

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId, useRef, useState } from 'react';
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
      {(props) => <ClearableInput className="field__control" {...props} {...input} />}
    </Field>
  );
}

/** ما يُكتب سطراً. التاريخ والرقم والملف والبحث لها أزرارها الأصلية فلا ✕ فوقها */
const CLEARABLE_TYPES = new Set(['text', 'email', 'tel', 'url', 'password']);

/**
 * خانة كتابة بـ ✕ في نهاية المكتوب يمحوها ويُبقي المؤشّر فيها — كل خانات المكوّن المشترك
 * (27 أكتوبر 2026، بطلب صاحبة المشروع). لا يظهر والخانة فارغة أو معطّلة أو للقراءة وحدها.
 *
 * المحو يمرّ بـ `onChange` صاحب الخانة كأن المستخدم مسحها بنفسه، فلا تحتاج صفحة معالجاً
 * آخر. الغلاف ثابت ولو فرغت الخانة — تبديله يعيد إنشاء الحقل فيضيع التركيز مع أول حرف.
 * الزرّ خارج تسلسل Tab: من يتنقّل بلوحة المفاتيح ينتقل إلى الخانة التالية لا إلى ✕.
 * اسمه «امسح المكتوب» لا يحوي تسمية الخانة: البحث بالتسمية يجد الخانة وحدها.
 */
export function ClearableInput(input: InputHTMLAttributes<HTMLInputElement>) {
  const own = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(() => String(input.defaultValue ?? '') !== '');
  if (!CLEARABLE_TYPES.has(input.type ?? 'text')) return <input {...input} />;

  const filled = input.value !== undefined ? String(input.value) !== '' : typed;
  const shown = filled && !input.disabled && !input.readOnly;
  const clear = () => {
    const el = own.current;
    if (!el) return;
    // الضابط الأصلي ثم حدث «input»: React يراه كتابةً فيستدعي onChange بقيمة فارغة
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  return (
    // اتجاه الغلاف من الخانة: ✕ في نهاية سطرها — يميناً للبريد والجوال، ويساراً للعربي
    <span className="field__clearable" dir={input.dir === 'ltr' || input.dir === 'rtl' ? input.dir : undefined}>
      <input
        {...input}
        ref={own}
        onChange={(e) => {
          setTyped(e.target.value !== '');
          input.onChange?.(e);
        }}
      />
      {shown ? (
        <button
          type="button"
          className="field__clear"
          aria-label="امسح المكتوب"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
        >
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </span>
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

export function Spinner({ label = 'جارٍ التحميل' }: { label?: string }) {
  return (
    <p className="row muted small">
      <span className="spinner" aria-hidden />
      {label}
    </p>
  );
}

/**
 * «المزيد» تحت قائمة طويلة ومعه «<المعروض> من <الإجمالي>» — يختفي حين تكتمل. يأخذ ما يعيده
 * `useAdminList` كما هو: `<MoreButton list={list} />`. في لوحتي الإدارة والبائع.
 * و«السابق» بجانبه ما دام «المزيد» ألحق صفحة: يُسقط آخرها فتعود القائمة كما كانت قبلها.
 */
export function MoreButton({
  list,
}: {
  list: {
    items: unknown[];
    total: number;
    hasMore: boolean;
    loadingMore: boolean;
    moreError: string | null;
    more: () => void;
    less?: () => void;
    canLess?: boolean;
  };
}) {
  const bar = useRef<HTMLDivElement>(null);
  if (!list.hasMore && !list.moreError && !list.canLess) return null;
  const less = () => {
    list.less?.();
    // القائمة قصرت من تحت — يبقى الزرّان أمام العين لا تقفز الصفحة بعيداً عنهما
    requestAnimationFrame(() => bar.current?.scrollIntoView({ block: 'center' }));
  };
  return (
    <div className="list-more" ref={bar}>
      <span className="list-more__count num">
        {list.items.length} من {list.total}
      </span>
      {list.moreError ? (
        <span className="list-more__error" role="alert">
          {list.moreError}
        </span>
      ) : null}
      {list.canLess && list.less ? (
        <button type="button" className="btn btn--ghost btn--sm" disabled={list.loadingMore} onClick={less}>
          السابق
        </button>
      ) : null}
      {list.hasMore || list.moreError ? (
        <button type="button" className="btn btn--secondary btn--sm" disabled={list.loadingMore} onClick={list.more}>
          {list.loadingMore ? 'جارٍ التحميل…' : list.moreError ? 'أعد المحاولة' : 'المزيد'}
        </button>
      ) : null}
    </div>
  );
}

/** ترتيب القوائم بتاريخها — ?sort= */
export type SortOrder = 'newest' | 'oldest';

/**
 * زرّ الترتيب بالتاريخ — يقلب بين «الأحدث أولاً» و«الأقدم أولاً» بضغطة. القائمة تُطلب من
 * جديد بترتيبها من أولها، لا تُعكس الصفحة المعروضة وحدها.
 */
export function SortButton({ value, onChange }: { value: SortOrder; onChange: (v: SortOrder) => void }) {
  const newest = value === 'newest';
  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm sort-btn"
      onClick={() => onChange(newest ? 'oldest' : 'newest')}
      aria-label={`الترتيب: ${newest ? 'الأحدث أولاً' : 'الأقدم أولاً'} — اضغط لعكسه`}
      title="اعكس الترتيب"
    >
      <Icon name="sort" size={14} />
      {newest ? 'الأحدث أولاً' : 'الأقدم أولاً'}
    </button>
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
