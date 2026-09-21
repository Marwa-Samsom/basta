'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Card, Field, TextInput } from '@/components/ui';
import { api, ApiError, session } from '@/lib/api';
import { cartApi, cartHeaders, type CartView } from '@/lib/cart';

interface OrderResult {
  orderId: string;
  orderNumber: string;
  outcome: 'paid' | 'failed' | 'requires_action' | 'pending';
}

/** بطاقات المزوّد الوهمي — كل واحدة تصنع حالة من حالات البوابة (ADR-012) */
const TEST_CARDS = [
  { token: 'tok_success', label: 'بطاقة تنجح' },
  { token: 'tok_decline', label: 'بطاقة يرفضها البنك' },
  { token: 'tok_insufficient', label: 'رصيد غير كافٍ' },
  { token: 'tok_timeout', label: 'ينقطع الاتصال بعد الخصم' },
  { token: 'tok_timeout_fail', label: 'ينقطع الاتصال بلا خصم' },
] as const;

/**
 * ST-15 — إتمام الشراء بخطوة واحدة: العنوان، الشحن لكل بائع، الدفع، المراجعة.
 *
 * **مفتاح عدم التكرار يولَّد مرة لكل محاولة ويبقى حتى تنتهي.** الضغط مرتين
 * على «ادفع»، أو إعادة الإرسال بعد انقطاع، يعيد الطلب نفسه لا طلباً ثانياً
 * (ADR-011). ويتجدّد فقط بعد فشل معروف — فمحاولة ببطاقة أخرى طلب جديد.
 */
export default function CheckoutPage() {
  const router = useRouter();
  // الخادم لا يعرف الجلسة: لقطته «ضيف»، والمتصفّح يصحّحها بعد الإماهة بلا عدم تطابق
  const signedIn = useSyncExternalStore(
    () => () => undefined,
    () => session.read() !== null,
    () => false,
  );

  const [address, setAddress] = useState({
    recipientName: '',
    phone: '',
    country: 'JO',
    region: '',
    city: '',
    street: '',
    building: '',
  });
  const [email, setEmail] = useState('');
  const [card, setCard] = useState<string>('tok_success');
  const [quote, setQuote] = useState<CartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef<string | null>(null);

  const set = (key: keyof typeof address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setAddress((a) => ({ ...a, [key]: e.target.value }));

  async function calculate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const q = await cartApi.quote({ country: address.country, region: address.region, city: address.city });
      setQuote(q);
      setBlockers(q.blockers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حساب الشحن.');
    } finally {
      setBusy(false);
    }
  }

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    attemptKey.current ??= crypto.randomUUID();
    try {
      const result = await api<OrderResult>('/checkout', {
        method: 'POST',
        headers: { ...cartHeaders(), 'idempotency-key': attemptKey.current },
        body: {
          address: {
            ...address,
            ...(address.building ? {} : { building: undefined }),
          },
          paymentToken: card,
          ...(signedIn ? {} : { guestEmail: email }),
        },
      });
      // الفشل المعروف ينهي المحاولة: المحاولة التالية طلب جديد بمفتاح جديد
      if (result.outcome === 'failed') attemptKey.current = null;
      router.push(`/orders/${result.orderNumber}`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details?.['blockers'])) {
        setBlockers(err.details['blockers'] as string[]);
      }
      // خطأ قبل الدفع (مخزون، تحقّق) لا يستهلك المفتاح؛ خطأ شبكة يُبقيه فلا يُدفع مرتين
      if (err instanceof ApiError) attemptKey.current = null;
      setError(err instanceof Error ? err.message : 'تعذّر إتمام الطلب.');
    } finally {
      setBusy(false);
    }
  }

  const ready = quote !== null && blockers.length === 0 && (signedIn || email.includes('@'));

  return (
    <div className="checkout">
      <div className="stack">
        <h1>إتمام الشراء</h1>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {blockers.length > 0 ? (
          <Alert tone="warning" title="قبل الدفع">
            <ul className="blockers">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <Card title="1 · العنوان">
          <div className="grid-2">
            <TextInput label="اسم المستلم" value={address.recipientName} onChange={set('recipientName')} />
            <TextInput label="الهاتف" dir="ltr" inputMode="tel" value={address.phone} onChange={set('phone')} />
          </div>
          <div className="grid-2">
            <Field label="البلد">
              {(props) => (
                <select className="field__control" {...props} value={address.country} onChange={set('country')}>
                  <option value="JO">الأردن</option>
                  <option value="SA">السعودية</option>
                  <option value="AE">الإمارات</option>
                  <option value="KW">الكويت</option>
                  <option value="EG">مصر</option>
                </select>
              )}
            </Field>
            <TextInput label="المحافظة / المنطقة" value={address.region} onChange={set('region')} />
          </div>
          <div className="grid-2">
            <TextInput label="المدينة" value={address.city} onChange={set('city')} />
            <TextInput label="الشارع ورقم البناء" value={address.street} onChange={set('street')} />
          </div>
          {!signedIn ? (
            <TextInput
              label="البريد الإلكتروني"
              hint="نرسل إليه تأكيد الطلب ورابط تتبّعه — تشتري ضيفاً بلا حساب."
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || !address.region || !address.city}
            onClick={() => void calculate()}
          >
            احسب الشحن
          </button>
        </Card>

        {quote ? (
          <Card title="2 · الشحن — كل متجر يشحن منفصلاً">
            {quote.groups.map((g) => (
              <p key={g.vendorId} className="row row--between">
                <span>{g.vendorNameAr}</span>
                <span className="money num">{g.shipping?.formatted ?? '—'}</span>
              </p>
            ))}
          </Card>
        ) : null}

        <Card title="3 · الدفع" hint="بيئة تجريبية: اختر كيف تتصرّف البطاقة.">
          <div className="stack stack--tight">
            {TEST_CARDS.map((c) => (
              <label key={c.token} className="choice">
                <input
                  type="radio"
                  name="card"
                  value={c.token}
                  checked={card === c.token}
                  onChange={() => setCard(c.token)}
                />
                <span className="choice__title">{c.label}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>

      <aside className="card summary">
        <h2>4 · المراجعة</h2>
        {quote ? (
          <dl className="summary__rows">
            <div>
              <dt>المنتجات</dt>
              <dd className="money num">{quote.totals.items.formatted}</dd>
            </div>
            {quote.totals.discount.minorUnits !== '0' ? (
              <div>
                <dt>الخصم</dt>
                <dd className="money num">− {quote.totals.discount.formatted}</dd>
              </div>
            ) : null}
            <div>
              <dt>الشحن</dt>
              <dd className="money num">{quote.totals.shipping.formatted}</dd>
            </div>
            <div>
              <dt>{quote.taxInclusive ? 'الضريبة (مشمولة)' : 'الضريبة'}</dt>
              <dd className="money num">{quote.totals.tax.formatted}</dd>
            </div>
            <div className="summary__total">
              <dt>الإجمالي</dt>
              <dd className="money num">{quote.totals.total.formatted}</dd>
            </div>
          </dl>
        ) : (
          <p className="small muted">أدخل العنوان واحسب الشحن لترى الإجمالي النهائي.</p>
        )}
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!ready || busy}
          onClick={() => void pay()}
        >
          {busy ? 'جارٍ الدفع…' : 'ادفع'}
        </button>
        <p className="small muted">لا يُخصم شيء قبل أن تضغط «ادفع»، والمخزون يُحجز لك لحظتها.</p>
      </aside>
    </div>
  );
}
