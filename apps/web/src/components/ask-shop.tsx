'use client';

import '@/styles/screens/messages.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui';
import { api, session } from '@/lib/api';

/** حدود نافذة السؤال — أضيق من حدّ الرسالة (1000): سؤال لا رسالة طويلة */
const ASK_MIN = 10;
const ASK_MAX = 500;

type AskContext = { productId: string } | { orderNumber: string };

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * ST-09 — «اسأل المتجر»: زرّ ونافذة `<dialog>` أصيلة (التركيز محبوس فيها،
 * و Esc والخلفية تغلقانها، والتركيز يعود إلى الزرّ). السياق يُرفق تلقائياً:
 * منتج من صفحته، أو شحنة متجر من تفاصيل الطلب. الضيف يُدعى إلى الدخول ثم
 * يعود إلى الصفحة نفسها. بعد الإرسال تأكيد برابط المحادثة في «رسائلي».
 */
export function AskShop({
  context,
  shopName,
  subjectName,
  subjectSub,
  thumb,
  triggerLabel,
  triggerClassName = 'btn btn--secondary ms-ask-trigger',
  title = 'اسأل المتجر',
  fieldLabel = 'سؤالك',
  iconSize = 17,
  placeholder = 'مثال: هل القطن مصري أصلي؟ وهل يتوفّر مقاس XL خلال الأسبوع؟',
}: {
  context: AskContext;
  shopName: string;
  subjectName: string;
  subjectSub?: string | undefined;
  thumb?: string | null | undefined;
  triggerLabel: string;
  triggerClassName?: string;
  title?: string;
  fieldLabel?: string;
  iconSize?: number;
  placeholder?: string;
}) {
  const pathname = usePathname();
  const signedIn = useSyncExternalStore(subscribe, () => !!session.read(), () => false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const hintId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (sentId) doneRef.current?.focus();
  }, [sentId]);

  function show(): void {
    setError(null);
    setSentId(null);
    setOpen(true);
  }

  /** النقر على الخلفية — الحدث يصل إلى <dialog> نفسه لا إلى محتواه */
  function onBackdrop(e: MouseEvent<HTMLDialogElement>): void {
    if (e.target === e.currentTarget) setOpen(false);
  }

  const trimmed = text.trim().length;
  const ok = signedIn && trimmed >= ASK_MIN;
  const tooShort = text.length > 0 && trimmed < ASK_MIN;
  const hint = !signedIn
    ? 'ادخل إلى حسابك لإرسال السؤال.'
    : ok
      ? 'يُرسل السؤال إلى المتجر ويظهر ردّه في رسائلك.'
      : 'اكتب سؤالاً من عشرة أحرف على الأقل.';
  const tone = ok ? 'ok' : text.length ? 'bad' : 'muted';

  async function submit(): Promise<void> {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/me/conversations', { method: 'POST', body: { ...context, body: text.trim() } });
      setSentId(r.id);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر إرسال السؤال.');
    } finally {
      setBusy(false);
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

  return (
    <>
      <button type="button" className={triggerClassName} onClick={show} aria-haspopup="dialog">
        <Icon name="msg" size={iconSize} />
        {triggerLabel}
      </button>

      <dialog ref={dialog} className="ms-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={onBackdrop}>
        <div className="ms-dialog__head">
          <h2 id={titleId} className="ms-dialog__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setOpen(false)}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {sentId ? (
          <>
            <div className="ms-dialog__body">
              <div className="ms-ask__done" role="status">
                <h3 ref={doneRef} tabIndex={-1} className="ms-ask__done-title">
                  أُرسل سؤالك إلى {shopName}
                </h3>
                <p className="ms-ask__note">
                  <Icon name="msg" size={14} />
                  يردّ المتجر عادةً في رسائلك خلال يوم عمل، ونُعلمك حين يصل الردّ.
                </p>
              </div>
            </div>
            <div className="ms-dialog__foot">
              <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
                إغلاق
              </button>
              <Link href={`/account/messages?c=${sentId}`} className="btn btn--primary">
                <Icon name="msg" size={16} />
                افتح المحادثة
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="ms-dialog__body">
              <div className="ms-subject">
                <span className="ms-subject__thumb" aria-hidden>
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" width={44} height={52} />
                  ) : (
                    <Icon name={'productId' in context ? 'image' : 'package'} size={19} />
                  )}
                </span>
                <span className="ms-subject__text">
                  <span className="ms-subject__name">{subjectName}</span>
                  {subjectSub ? <span className="ms-subject__sub">{subjectSub}</span> : null}
                </span>
                <span className="badge badge--brand">مُرفق تلقائياً</span>
              </div>

              {!signedIn ? (
                <div className="ms-guest">
                  <p className="ms-guest__text">
                    <Icon name="info" size={16} />
                    تحتاج إلى الدخول أولاً حتى يصل ردّ المتجر إلى رسائلك.
                  </p>
                  <Link href={loginHref} className="btn btn--primary btn--sm">
                    ادخل إلى حسابك
                  </Link>
                </div>
              ) : null}

              {error ? <Alert tone="danger">{error}</Alert> : null}

              <div className="ms-ask__field">
                <label className="ms-ask__label" htmlFor={fieldId}>
                  {fieldLabel}
                </label>
                <textarea
                  id={fieldId}
                  className="field__control"
                  rows={4}
                  maxLength={ASK_MAX}
                  placeholder={placeholder}
                  value={text}
                  aria-describedby={hintId}
                  aria-invalid={tooShort}
                  onChange={(e) => setText(e.target.value.slice(0, ASK_MAX))}
                />
                <span className="ms-ask__hint">
                  <span id={hintId} className="ms-ask__msg" data-tone={tone} aria-live="polite">
                    {hint}
                  </span>
                  <span className="ms-ask__count num" data-near={text.length > ASK_MAX - 40} aria-hidden>
                    {text.length} / {ASK_MAX}
                  </span>
                </span>
              </div>

              <p className="ms-ask__note">
                <Icon name="msg" size={14} />
                يردّ المتجر عادةً في رسائلك خلال يوم عمل.
              </p>
            </div>
            <div className="ms-dialog__foot">
              <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
                إلغاء
              </button>
              <button type="button" className="btn btn--primary" disabled={!ok || busy} onClick={() => void submit()}>
                {busy ? <span className="spinner" aria-hidden /> : <Icon name="msg" size={16} />}
                أرسل السؤال
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
