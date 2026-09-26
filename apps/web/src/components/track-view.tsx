'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Alert, TextInput } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { when } from '@/lib/orders';

/** ما يعيده `GET /track/:trackingNumber` — عامّ بلا حساب */
interface Tracking {
  carrierCode: string;
  carrierName: string;
  trackingNumber: string;
  /** created · picked_up · in_transit · out_for_delivery · delivered · failed */
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: { code: string; descriptionAr: string | null; location: string | null; occurredAt: string }[];
}

/** مسار الشحنة بترتيب شركة الشحن — الحدث لا يعود للخلف */
const STEPS = [
  { code: 'picked_up', label: 'استلمته شركة الشحن' },
  { code: 'in_transit', label: 'في الطريق' },
  { code: 'out_for_delivery', label: 'خرج للتوصيل' },
  { code: 'delivered', label: 'تم التسليم' },
] as const;

const STATUS_TEXT: Record<string, { tone: string; label: string }> = {
  created: { tone: 'badge--pending', label: 'بانتظار استلام شركة الشحن' },
  picked_up: { tone: 'badge--review', label: 'استلمته شركة الشحن' },
  in_transit: { tone: 'badge--review', label: 'في الطريق' },
  out_for_delivery: { tone: 'badge--review', label: 'خرج للتوصيل' },
  delivered: { tone: 'badge--approved', label: 'تم التسليم' },
  failed: { tone: 'badge--rejected', label: 'تعذّر التوصيل' },
};

/**
 * ST-31 — تتبّع الشحنة بلا حساب.
 *
 * الخادم يتتبّع برقم التتبّع وحده (`GET /track/:trackingNumber`): لا بحث
 * برقم الطلب والبريد بعد، فلا نطلبهما. والنتيجة مسار الشحنة وأحداثها فقط —
 * لا عنوان ولا اسم ولا قطع، فرقم التتبّع وحده لا يكشف بيانات المشتري.
 */
export function TrackView() {
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Tracking | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const value = number.trim();
    if (!value) {
      setError('اكتب رقم التتبّع كما وصلك من المتجر.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Tracking>(`/track/${encodeURIComponent(value)}`, { auth: false }));
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError && err.status === 404
          ? 'لم نجد شحنة بهذا الرقم. تحقّق من الرقم كما وصلك من المتجر — الشحنة تظهر بعد أن يصدر البائع بوليصتها.'
          : err instanceof Error
            ? err.message
            : 'تعذّر الاتصال. حاول مرة أخرى.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sx-page sx-track">
      <div className="page-head">
        <h1>تتبّع شحنتك</h1>
        <span className="page-head__meta">بلا حساب — برقم التتبّع وحده</span>
      </div>

      <div className="sx-track__layout">
        <form className="card sx-track__form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="card__body stack">
            <TextInput
              label="رقم التتبّع"
              hint="تجده في رسالة الشحن من المتجر أو في تفاصيل طلبك."
              error={error}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              inputMode="text"
            />
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {busy ? <Icon name="spinner" size={17} className="sx-spin" /> : <Icon name="truck" size={17} />}
              {busy ? 'جارٍ البحث…' : 'تتبّع الشحنة'}
            </button>
          </div>
          <div className="card__foot sx-track__foot">
            <Icon name="user" size={15} />
            <span>
              لديك حساب؟ <Link href="/account/orders">طلباتي</Link> تعرض كل متاجر طلبك وحالة كل منها.
            </span>
          </div>
        </form>

        {result ? <Result t={result} /> : null}
      </div>
    </div>
  );
}

function Result({ t }: { t: Tracking }) {
  const status = STATUS_TEXT[t.status] ?? { tone: 'badge--pending', label: t.status };
  const failed = t.status === 'failed';
  // آخر خطوة بلغتها الشحنة من أحداثها — «تعذّر» يُبقي المسار حيث توقّف
  const reached = STEPS.reduce(
    (at, s, i) => (t.status === s.code || t.events.some((e) => e.code === s.code) ? i : at),
    -1,
  );
  const reachedAt = (code: string): string | null =>
    [...t.events].reverse().find((e) => e.code === code)?.occurredAt ?? null;

  return (
    <section className="card sp-store sx-track__result" aria-labelledby="sx-track-title" aria-live="polite">
      <div className="sp-store__head">
        <Icon name="truck" size={18} />
        <h2 id="sx-track-title" className="sp-store__name">
          {t.carrierName}
        </h2>
        <span className="sp-store__no num">{t.trackingNumber}</span>
        <span className={`badge ${status.tone}`}>{status.label}</span>
      </div>
      <div className="sp-store__body">
        {failed ? (
          <Alert tone="warning" title="تعذّر التوصيل">
            سجّلت شركة الشحن أن محاولة التوصيل لم تتمّ. آخر حدث في السجلّ أدناه.
          </Alert>
        ) : null}

        <ol className="sp-track" aria-label="مسار الشحنة">
          {STEPS.map((s, i) => {
            const state = i < reached ? 'done' : i === reached ? (s.code === 'delivered' ? 'done' : 'current') : 'todo';
            const at = i <= reached ? reachedAt(s.code) : null;
            return (
              <li
                key={s.code}
                className="sp-track__step"
                data-state={state}
                {...(i === reached ? { 'aria-current': 'step' as const } : {})}
              >
                <span className="sp-track__dot" aria-hidden>
                  <Icon name={state === 'done' ? 'check' : state === 'current' ? 'clock' : 'minus'} size={15} />
                </span>
                <span className="sp-track__label">{s.label}</span>
                <span className="sp-track__date">{at ? when(at) : '—'}</span>
              </li>
            );
          })}
        </ol>

        {t.events.length ? (
          <div className="sp-ship">
            <p className="sp-ship__head">
              <Icon name="history" size={17} />
              سجلّ الشحنة
            </p>
            <ul className="sp-events">
              {t.events.map((e, i) => (
                <li key={i}>
                  <span>
                    {e.descriptionAr ?? STATUS_TEXT[e.code]?.label ?? e.code}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                  <span className="sp-events__when">{when(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="sx-track__none">
            <Icon name="info" size={15} />
            أصدر المتجر بوليصة الشحن، ولم تسجّل شركة الشحن أي حدث بعد.
          </p>
        )}
      </div>
    </section>
  );
}
