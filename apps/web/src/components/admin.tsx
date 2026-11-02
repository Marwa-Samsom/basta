'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { useT } from './locale';
import { Alert, Spinner, TextArea } from './ui';

/**
 * أدوات صفحات الإدارة المشتركة — ملف التصميم «Basta Admin Operations»:
 * رأس الصفحة، والتحميل بهيكل لا دوّار، والخطأ بإعادة محاولة، والإشعار
 * العابر، ونافذة السبب، ورقائق التصفية، والحالة الفارغة. الأنماط في
 * `styles/screens/admin-operations.css` بالبادئة `ao-`.
 */

/** رأس صفحة إدارية بعنوانها وما يقابلها من أزرار — `count` عدّاد أحادي الخطّ بجانب العنوان */
export function AdminHeader({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string | undefined;
  count?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-head ao-head">
      <h1>{title}</h1>
      {count !== undefined && count !== null ? <span className="page-head__count">{count}</span> : null}
      {hint ? <span className="page-head__meta">{hint}</span> : null}
      {children ? <div className="page-head__actions">{children}</div> : null}
    </header>
  );
}

/**
 * حالة التحميل والخطأ والمنع بصيغة واحدة في كل صفحة. التحميل هيكل بشكل
 * الصفحة، والخطأ مربّع بأيقونة وزرّ «أعد المحاولة» إن مُرِّر `onRetry`.
 * `inline` للأجزاء المتداخلة (تفاصيل تُفتح داخل صفّ): دوّار صغير وتنبيه.
 */
export function Loading({
  error,
  forbidden,
  label,
  onRetry,
  inline,
}: {
  error: string | null;
  forbidden?: boolean;
  label?: string;
  onRetry?: (() => void) | undefined;
  inline?: boolean;
}) {
  const t = useT();
  if (forbidden) {
    return (
      <div className="ao-note" data-tone="warning" role="status">
        <Icon name="lock" size={16} />
        <span>
          {t('هذه الصفحة تحتاج صلاحية لا يملكها حسابك.', "This page needs a permission your account doesn't have.")} {error}
        </span>
      </div>
    );
  }
  if (error) {
    if (inline) return <Alert tone="danger">{error}</Alert>;
    return (
      <div className="ao-error" role="alert">
        <span className="ao-error__icon" aria-hidden>
          <Icon name="alert" size={25} />
        </span>
        <p className="ao-error__title">{t('حدث خلل غير متوقّع ولم يكتمل طلبك', "Something unexpected went wrong and your request wasn't completed")}</p>
        <p className="ao-error__body">{error}</p>
        {onRetry ? (
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            {t('أعد المحاولة', 'Try again')}
          </button>
        ) : null}
      </div>
    );
  }
  if (inline) return <Spinner label={label ?? t('جارٍ التحميل…', 'Loading…')} />;
  return (
    <div className="ao-skel" role="status" aria-live="polite">
      <span className="visually-hidden">{label ?? t('جارٍ التحميل…', 'Loading…')}</span>
      <span className="skeleton ao-skel__line" aria-hidden />
      <span className="skeleton ao-skel__block" aria-hidden />
      <span className="skeleton ao-skel__table" aria-hidden />
    </div>
  );
}

/**
 * الخطأ تنبيه في مكانه لأنه يحتاج قراءة وتصرّفاً، والنجاح إشعار عابر أسفل
 * الصفحة كما في التصميم — يُغلق بزرّه أو يختفي وحده. المنطقة الحيّة ثابتة
 * في الشجرة ليُعلَن الإشعار لقارئ الشاشة لحظة ظهوره.
 */
export function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="ao-toast-region" role="status" aria-live="polite">
        {notice ? <Toast key={notice} message={notice} /> : null}
      </div>
    </>
  );
}

function Toast({ message }: { message: string }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(false), 6000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!open) return null;
  return (
    <div className="ao-toast">
      <Icon name="check-circle" size={18} />
      <span className="ao-toast__msg">{message}</span>
      <button type="button" className="ao-toast__close" aria-label={t('إغلاق', 'Close')} onClick={() => setOpen(false)}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

/**
 * زرّ بسبب مكتوب — رفض، تعليق، إلغاء. السبب يُعرض للطرف الآخر كما يُكتب.
 * يفتح نافذة التصميم (رأس وحقل وتذييل)، لكنها لا تُغلق بنقرة خارجها بالخطأ:
 * الخروج بـ «تراجع» أو Esc، والمكتوب يبقى إن فُتحت ثانية.
 */
export function ReasonButton({
  label,
  confirmLabel,
  tone = 'danger',
  min = 5,
  hint,
  presets,
  disabled,
  icon,
  onSubmit,
}: {
  label: string;
  confirmLabel?: string;
  tone?: 'danger' | 'secondary' | 'primary';
  min?: number;
  hint?: string;
  presets?: string[];
  disabled?: boolean;
  icon?: IconName;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const triggerIcon = icon ?? (tone === 'danger' ? 'x' : undefined);
  const short = reason.trim().length < min;

  return (
    <>
      <button
        type="button"
        className={`btn btn--${tone === 'primary' ? 'primary' : tone === 'secondary' ? 'secondary' : 'danger'} btn--sm`}
        disabled={disabled}
        onClick={() => ref.current?.showModal()}
      >
        {triggerIcon ? <Icon name={triggerIcon} size={14} /> : null}
        {label}
      </button>
      <dialog ref={ref} className="ao-dialog" aria-labelledby={titleId}>
        <div className="ao-dialog__head">
          <h2 id={titleId}>{label}</h2>
          <button type="button" className="icon-btn icon-btn--sm ao-dialog__x" aria-label={t('إغلاق', 'Close')} onClick={() => ref.current?.close()}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="ao-dialog__body">
          {presets?.length ? (
            <div className="chips">
              {presets.map((p) => (
                <button key={p} type="button" className={`chip${reason === p ? ' chip--on' : ''}`} aria-pressed={reason === p} onClick={() => setReason(p)}>
                  {p}
                </button>
              ))}
            </div>
          ) : null}
          <TextArea
            label={t('السبب', 'Reason')}
            hint={hint ?? t('يُحفظ في السجل ويُعرض لصاحب الشأن كما تكتبه.', "It's saved in the log and shown to the person concerned exactly as you write it.")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <div className="ao-dialog__foot">
          <button type="button" className="btn btn--secondary" onClick={() => ref.current?.close()}>
            {t('تراجع', 'Cancel')}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'primary' ? 'btn--primary' : 'ao-btn--danger-solid'}`}
            disabled={disabled || sending || short}
            onClick={async () => {
              setSending(true);
              const ok = await onSubmit(reason.trim());
              setSending(false);
              // يُغلق في الحالين: الفشل يظهر تنبيهه في الصفحة، والسبب المكتوب يبقى لإعادة المحاولة
              ref.current?.close();
              if (ok) setReason('');
            }}
          >
            {tone === 'primary' ? <Icon name="check" size={16} /> : null}
            {confirmLabel ?? label}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** رقائق تصفية بعدّاد اختياري — المختارة بتعبئة العلامة كما في التصميم */
export function Tabs({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { key: string; label: string; count?: number | string | undefined }[];
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="tabs ao-tabs" role="tablist" {...(label ? { 'aria-label': label } : {})}>
      {options.map((o) => (
        <button key={o.key} type="button" role="tab" className="tabs__tab" aria-selected={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          {o.count !== undefined ? <span className="tabs__count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** خانة البحث في شريط الأدوات — بأيقونتها، وعرضها كامل السطر على الجوال */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className = 'ao-search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <span className={`input-icon ${className}`}>
      <Icon name="search" size={15} />
      <input className="field__control" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </span>
  );
}

/** «المزيد» مشترك مع لوحة البائع — في مكتبة الواجهة */
export { MoreButton, SortButton } from './ui';

/**
 * حالة فارغة — مربّع أيقونة وعنوان وجملة تقول ما التالي. بلا `title` يصير
 * النصّ الممرَّر هو العنوان (الاستعمال القديم `<Empty>لا كوبونات.</Empty>`).
 */
export function Empty({
  children,
  title,
  icon = 'list',
  tone,
  actions,
}: {
  children?: ReactNode;
  title?: string;
  icon?: IconName;
  tone?: 'success' | undefined;
  actions?: ReactNode;
}) {
  return (
    <div className="ao-empty" {...(tone ? { 'data-tone': tone } : {})}>
      <span className="ao-empty__icon" aria-hidden>
        <Icon name={icon} size={24} />
      </span>
      {title ? <p className="ao-empty__title">{title}</p> : null}
      {children ? <p className={title ? 'ao-empty__body' : 'ao-empty__title'}>{children}</p> : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
