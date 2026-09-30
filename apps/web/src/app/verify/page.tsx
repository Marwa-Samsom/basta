'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { api, ApiError, session } from '@/lib/api';
import { safeNext } from '@/lib/safe-path';

interface Status {
  email: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pending: { expiresAt: string; attemptsLeft: number } | null;
  resendAfterSeconds: number;
}

const CELLS = 6;
const EMPTY = Array.from({ length: CELLS }, () => '');
/** أسباب لا ينفع بعدها إلا رمز جديد — الخانات تُقفل حتى يُطلب */
const DEAD = new Set(['exhausted', 'expired', 'already_used', 'not_found']);

const clock = (secs: number): string => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

/**
 * SH-03 — تأكيد البريد بالرمز.
 *
 * لا يحجب شيئاً: بعد التسجيل تصل الصفحة إلى هنا ومعها «تخطَّ الآن»، والحساب
 * يعمل كاملاً قبل التأكيد. الرمز يُطلب تلقائياً مرة عند الوصول إن لم يكن
 * هناك رمز حيّ — والعودة إلى الصفحة لا ترسل غيره قبل مهلة الدقيقة.
 */
function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/account');

  const [status, setStatus] = useState<Status | null>(null);
  const [digits, setDigits] = useState<string[]>(EMPTY);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [dead, setDead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [resendAt, setResendAt] = useState(0);
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const asked = useRef(false);

  const apply = useCallback((s: Status) => {
    setStatus(s);
    setResendAt(Date.now() + s.resendAfterSeconds * 1000);
    setNow(Date.now());
  }, []);

  const send = useCallback(async () => {
    setSending(true);
    setMsg(null);
    try {
      const s = await api<Status>('/me/account/email-verification', { method: 'POST' });
      apply(s);
      setDigits(EMPTY);
      setDead(false);
      cells.current[0]?.focus();
    } catch (err) {
      const e = err as ApiError;
      const wait = Number(e.details?.['retryAfterSeconds'] ?? 0);
      if (wait > 0) setResendAt(Date.now() + wait * 1000);
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setSending(false);
    }
  }, [apply]);

  useEffect(() => {
    if (!session.read()) {
      router.replace(`/login?next=${encodeURIComponent(`/verify?next=${next}`)}`);
      return;
    }
    let alive = true;
    api<Status>('/me/account/email-verification')
      .then((s) => {
        if (!alive) return;
        apply(s);
        // رمز واحد تلقائياً عند الوصول — لا عند كل تحديث للصفحة
        if (!s.verified && s.email && !s.pending && s.resendAfterSeconds === 0 && !asked.current) {
          asked.current = true;
          void send();
        }
      })
      .catch((e: Error) => alive && setMsg({ kind: 'error', text: e.message }));
    return () => {
      alive = false;
    };
  }, [router, next, apply, send]);

  // عدّاد الصلاحية ومهلة إعادة الإرسال — ثانية بثانية
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const expiresIn = status?.pending ? Math.max(0, Math.ceil((Date.parse(status.pending.expiresAt) - now) / 1000)) : 0;
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expired = Boolean(status?.pending) && expiresIn === 0;
  const locked = dead || expired || !status?.pending;
  const code = digits.join('');

  function fill(from: number, raw: string): void {
    const clean = raw.replace(/\D/g, '');
    setMsg(null);
    if (clean.length > 1) {
      // لصق أو إكمال تلقائي: يتوزّع على الخانات من هذه الخانة فصاعداً
      const arr = [...digits];
      clean.slice(0, CELLS - from).split('').forEach((ch, k) => (arr[from + k] = ch));
      setDigits(arr);
      cells.current[Math.min(CELLS - 1, from + clean.length - 1)]?.focus();
      return;
    }
    const arr = [...digits];
    arr[from] = clean;
    setDigits(arr);
    if (clean && from < CELLS - 1) cells.current[from + 1]?.focus();
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (locked) return;
    if (code.length < CELLS) {
      setMsg({ kind: 'error', text: 'أكمل الخانات الست.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const s = await api<Status>('/me/account/email-verification/confirm', { method: 'POST', body: { code } });
      setStatus(s);
      setMsg({ kind: 'ok', text: 'تمّ تأكيد بريدك.' });
    } catch (err) {
      const e = err as ApiError;
      const reason = String(e.details?.['reason'] ?? '');
      if (DEAD.has(reason) || e.details?.['attemptsLeft'] === 0) setDead(true);
      setMsg({ kind: 'error', text: e.message });
      setDigits(EMPTY);
      cells.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  const verified = status?.verified === true;

  return (
    <main className="ac-auth">
      <div className="ac-auth__box">
        <header className="ac-auth__head">
          <Link href="/" className="ac-wordmark">
            بسطة
          </Link>
          <h1 className="ac-auth__title">{verified ? 'بريدك مؤكَّد' : 'أكّد بريدك الإلكتروني'}</h1>
          <p className="ac-auth__sub">
            {verified ? 'يصلك على هذا البريد كل ما يخصّ طلباتك وحسابك.' : 'اكتب الرمز أو الصقه كاملاً في الخانة الأولى.'}
          </p>
        </header>

        {!status && !msg ? (
          <div className="ac-auth__card" role="status">
            <span className="id-skel skeleton" />
            <span className="visually-hidden">جارٍ التحضير…</span>
          </div>
        ) : verified ? (
          <section className="ac-auth__card">
            <div className="alert alert--success ac-note" role="status">
              <Icon name="check-circle" size={16} />
              <span>تمّ تأكيد بريدك. لا حاجة لرمز آخر.</span>
            </div>
            <Link href={next} className="btn btn--primary btn--block ac-auth__cta">
              تابع
            </Link>
          </section>
        ) : (
          <form className="ac-auth__card" onSubmit={submit} noValidate>
            {status?.pending && status.email ? (
              <div className="alert alert--info ac-note" role="status">
                <Icon name="info" size={16} />
                <span>
                  أرسلنا رمزاً من ست خانات إلى{' '}
                  <bdi dir="ltr" className="id-addr">
                    {status.email}
                  </bdi>
                </span>
              </div>
            ) : null}
            {status && !status.email ? (
              <div className="alert alert--warning ac-note" role="status">
                <Icon name="alert" size={16} />
                <span>لا بريد في حسابك لنرسل إليه الرمز.</span>
              </div>
            ) : null}

            <div className="id-otp" role="group" aria-labelledby="otp-label">
              <span id="otp-label" className="field__label">
                رمز التحقّق
              </span>
              <div className="id-otp__cells" dir="ltr">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      cells.current[i] = el;
                    }}
                    className="id-otp__cell"
                    data-filled={d ? 'true' : undefined}
                    data-error={msg?.kind === 'error' ? 'true' : undefined}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`الخانة ${i + 1} من ${CELLS}`}
                    maxLength={CELLS}
                    value={d}
                    disabled={locked || busy}
                    onChange={(e) => fill(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !digits[i] && i > 0) cells.current[i - 1]?.focus();
                    }}
                    onPaste={(e) => {
                      const txt = e.clipboardData.getData('text').replace(/\D/g, '');
                      if (!txt) return;
                      e.preventDefault();
                      const arr = [...EMPTY];
                      txt.slice(0, CELLS).split('').forEach((ch, k) => (arr[k] = ch));
                      setDigits(arr);
                      setMsg(null);
                      cells.current[Math.min(CELLS, txt.length) - 1]?.focus();
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="id-otp__meta">
              {status?.pending ? (
                <span className="id-expiry" data-urgent={expiresIn < 60 ? 'true' : undefined}>
                  <Icon name="clock" size={15} />
                  {expired ? (
                    'انتهت صلاحية الرمز'
                  ) : (
                    <>
                      ينتهي بعد{' '}
                      <bdi dir="ltr" className="num">
                        {clock(expiresIn)}
                      </bdi>
                    </>
                  )}
                </span>
              ) : null}
              <button
                type="button"
                className="btn btn--secondary btn--sm id-resend"
                onClick={() => void send()}
                disabled={resendIn > 0 || sending || !status?.email}
              >
                {sending ? (
                  'جارٍ الإرسال…'
                ) : resendIn > 0 ? (
                  <>
                    أعد الإرسال بعد <span className="num">{resendIn}</span> ث
                  </>
                ) : status?.pending ? (
                  'أعد إرسال الرمز'
                ) : (
                  'أرسل الرمز'
                )}
              </button>
            </div>

            <div aria-live="polite">
              {msg ? (
                <div className={`alert alert--${msg.kind === 'ok' ? 'success' : 'danger'} ac-note`}>
                  <Icon name={msg.kind === 'ok' ? 'check-circle' : 'alert'} size={16} />
                  <span>{msg.text}</span>
                </div>
              ) : null}
            </div>

            <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={locked || busy}>
              {busy ? 'جارٍ التحقّق…' : 'تحقّق'}
            </button>
          </form>
        )}

        {verified ? null : (
          <p className="ac-auth__foot">
            <span>التأكيد لا يوقف تسوّقك.</span>
            <Link href={next}>تخطَّ الآن</Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main className="ac-auth" />}>
      <VerifyForm />
    </Suspense>
  );
}
