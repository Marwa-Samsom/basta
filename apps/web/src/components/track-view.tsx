'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, TextInput } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { carrierName, when } from '@/lib/orders';

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
  { code: 'picked_up', label: 'استلمته شركة الشحن', en: 'Picked up by the carrier' },
  { code: 'in_transit', label: 'في الطريق', en: 'In transit' },
  { code: 'out_for_delivery', label: 'خرج للتوصيل', en: 'Out for delivery' },
  { code: 'delivered', label: 'تم التسليم', en: 'Delivered' },
] as const;

const STATUS_TEXT: Record<string, { tone: string; label: string; en: string }> = {
  created: { tone: 'badge--pending', label: 'بانتظار استلام شركة الشحن', en: 'Waiting for carrier pickup' },
  picked_up: { tone: 'badge--review', label: 'استلمته شركة الشحن', en: 'Picked up by the carrier' },
  in_transit: { tone: 'badge--review', label: 'في الطريق', en: 'In transit' },
  out_for_delivery: { tone: 'badge--review', label: 'خرج للتوصيل', en: 'Out for delivery' },
  delivered: { tone: 'badge--approved', label: 'تم التسليم', en: 'Delivered' },
  failed: { tone: 'badge--rejected', label: 'تعذّر التوصيل', en: 'Delivery failed' },
};

/**
 * ST-31 — تتبّع الشحنة بلا حساب.
 *
 * الخادم يتتبّع برقم التتبّع وحده (`GET /track/:trackingNumber`): لا بحث
 * برقم الطلب والبريد بعد، فلا نطلبهما. والنتيجة مسار الشحنة وأحداثها فقط —
 * لا عنوان ولا اسم ولا قطع، فرقم التتبّع وحده لا يكشف بيانات المشتري.
 */
export function TrackView() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [number, setNumber] = useState(() => params.get('number') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Tracking | null>(null);
  /** آخر رقم بُحث عنه — كي لا يُعاد البحث حين يكتب البحثُ نفسُه الرقمَ في العنوان */
  const looked = useRef<string | null>(null);

  const lookup = useCallback(
    async (value: string): Promise<void> => {
      looked.current = value;
      setBusy(true);
    setError(null);
    try {
      setResult(await api<Tracking>(`/track/${encodeURIComponent(value)}`, { auth: false }));
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError && err.status === 404
          ? t(
              'لم نجد شحنة بهذا الرقم. تحقّق من الرقم كما وصلك من المتجر — الشحنة تظهر بعد أن يصدر البائع بوليصتها.',
              "We couldn't find a shipment with this number. Check the number the shop sent you — a shipment appears once the seller issues its waybill.",
            )
          : err instanceof Error
            ? err.message
            : t('تعذّر الاتصال. حاول مرة أخرى.', "Couldn't connect. Try again."),
      );
    } finally {
      setBusy(false);
    }
    },
    [t],
  );

  // الرقم في العنوان (من «تتبّع الشحنة» في تفاصيل الطلب أو رابط أُرسل) يُبحث عنه وحده
  const fromUrl = params.get('number')?.trim() ?? '';
  useEffect(() => {
    if (!fromUrl || fromUrl === looked.current) return;
    setNumber(fromUrl);
    void lookup(fromUrl);
  }, [fromUrl, lookup]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const value = number.trim();
    if (!value) {
      setError(t('اكتب رقم التتبّع كما وصلك من المتجر.', 'Enter the tracking number exactly as the shop sent it.'));
      return;
    }
    // في العنوان أيضاً: يُنسخ الرابط فيفتح النتيجة نفسها
    router.replace(`${pathname}?number=${encodeURIComponent(value)}`, { scroll: false });
    await lookup(value);
  }

  return (
    <div className="sx-page sx-track">
      <div className="page-head">
        <h1>{t('تتبّع شحنتك', 'Track your shipment')}</h1>
        <span className="page-head__meta">{t('بلا حساب — برقم التتبّع وحده', 'No account needed — just the tracking number')}</span>
      </div>

      <div className="sx-track__layout">
        <form className="card sx-track__form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="card__body stack">
            <TextInput
              label={t('رقم التتبّع', 'Tracking number')}
              hint={t('تجده في رسالة الشحن من المتجر أو في تفاصيل طلبك.', "You'll find it in the shop's shipping message or in your order details.")}
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
              {busy ? t('جارٍ البحث…', 'Searching…') : t('تتبّع الشحنة', 'Track shipment')}
            </button>
          </div>
          <div className="card__foot sx-track__foot">
            <Icon name="user" size={15} />
            <span>
              {t('لديك حساب؟ ', 'Have an account? ')}
              <Link href="/account/orders">{t('طلباتي', 'My orders')}</Link>
              {t(' تعرض كل متاجر طلبك وحالة كل منها.', ' shows every shop in your order and the status of each.')}
            </span>
          </div>
        </form>

        {result ? <Result t={result} /> : null}
      </div>
    </div>
  );
}

function Result({ t: tr }: { t: Tracking }) {
  const t = useT();
  const locale = useLocale();
  const known = STATUS_TEXT[tr.status];
  const status = known ? { tone: known.tone, label: t(known.label, known.en) } : { tone: 'badge--pending', label: tr.status };
  const failed = tr.status === 'failed';
  const carrierEn = carrierName(tr.carrierCode, 'en');
  const carrier = locale === 'en' && carrierEn !== tr.carrierCode ? carrierEn : tr.carrierName;
  // آخر خطوة بلغتها الشحنة من أحداثها — «تعذّر» يُبقي المسار حيث توقّف
  const reached = STEPS.reduce(
    (at, s, i) => (tr.status === s.code || tr.events.some((e) => e.code === s.code) ? i : at),
    -1,
  );
  const reachedAt = (code: string): string | null =>
    [...tr.events].reverse().find((e) => e.code === code)?.occurredAt ?? null;
  const eventText = (e: Tracking['events'][number]): string => {
    const label = STATUS_TEXT[e.code];
    // بالإنجليزية: وصف الحدث من رمزه — وصف الخادم عربي
    if (locale === 'en' && label) return label.en;
    return e.descriptionAr ?? label?.label ?? e.code;
  };

  return (
    <section className="card sp-store sx-track__result" aria-labelledby="sx-track-title" aria-live="polite">
      <div className="sp-store__head">
        <Icon name="truck" size={18} />
        <h2 id="sx-track-title" className="sp-store__name">
          {carrier}
        </h2>
        <span className="sp-store__no num">{tr.trackingNumber}</span>
        <span className={`badge ${status.tone}`}>{status.label}</span>
      </div>
      <div className="sp-store__body">
        {failed ? (
          <Alert tone="warning" title={t('تعذّر التوصيل', 'Delivery failed')}>
            {t(
              'سجّلت شركة الشحن أن محاولة التوصيل لم تتمّ. آخر حدث في السجلّ أدناه.',
              "The carrier recorded that the delivery attempt didn't go through. The latest event is in the log below.",
            )}
          </Alert>
        ) : null}

        <ol className="sp-track" aria-label={t('مسار الشحنة', 'Shipment progress')}>
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
                <span className="sp-track__label">{t(s.label, s.en)}</span>
                <span className="sp-track__date">{at ? when(at, locale) : '—'}</span>
              </li>
            );
          })}
        </ol>

        {tr.events.length ? (
          <div className="sp-ship">
            <p className="sp-ship__head">
              <Icon name="history" size={17} />
              {t('سجلّ الشحنة', 'Shipment log')}
            </p>
            <ul className="sp-events">
              {tr.events.map((e, i) => (
                <li key={i}>
                  <span>
                    {eventText(e)}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                  <span className="sp-events__when">{when(e.occurredAt, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="sx-track__none">
            <Icon name="info" size={15} />
            {t('أصدر المتجر بوليصة الشحن، ولم تسجّل شركة الشحن أي حدث بعد.', "The shop issued the waybill, but the carrier hasn't recorded any events yet.")}
          </p>
        )}
      </div>
    </section>
  );
}
