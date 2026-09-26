'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Alert, Field, PageHead, TextInput } from '@/components/ui';
import { api, ApiError, session } from '@/lib/api';
import { cartApi, cartHeaders, type CartView } from '@/lib/cart';
import { imageUrl } from '@/lib/storefront';

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

const thumbOf = (key: string | null): string | null => (key ? imageUrl(`/uploads/${key}/thumb.webp`) : null);

/** تمييز العدد بالعربية يتغيّر بالعدد نفسه */
function pieces(n: number): string {
  if (n === 1) return 'قطعة واحدة';
  if (n === 2) return 'قطعتان';
  if (n <= 10) return `${n} قطع`;
  return `${n} قطعة`;
}
function shipments(n: number): string {
  if (n === 1) return 'شحنة واحدة من متجر واحد';
  if (n === 2) return 'شحنتين من متجرين';
  if (n <= 10) return `${n} شحنات من ${n} متاجر`;
  return `${n} شحنة من ${n} متجراً`;
}

type StepState = 'done' | 'current' | 'todo';

/** خطوة مرقّمة — الدائرة تصير علامة صحّ حين تكتمل، والحالية بإطار العلامة */
function Section({ n, title, state, children }: { n: number; title: string; state: StepState; children: ReactNode }) {
  return (
    <section className="sp-sec" data-state={state} aria-labelledby={`sec-${n}`}>
      <header className="sp-sec__head">
        <span className="sp-sec__num" aria-hidden>
          {state === 'done' ? <Icon name="check" size={15} /> : n}
        </span>
        <div className="sp-sec__titles">
          <h2 className="sp-sec__title" id={`sec-${n}`}>
            {title}
            {state === 'done' ? <span className="visually-hidden"> — مكتملة</span> : null}
          </h2>
        </div>
      </header>
      <div className="sp-sec__body">{children}</div>
    </section>
  );
}

/**
 * ST-15 — إتمام الشراء بخطوة واحدة: التواصل، العنوان، الشحن لكل بائع، الدفع، المراجعة.
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

  const contactOk = address.phone.trim() !== '' && (signedIn || email.includes('@'));
  const ready = quote !== null && blockers.length === 0 && (signedIn || email.includes('@'));

  // الخطوة الحالية: أوّل خطوة لم تكتمل. الدفع مختار دائماً، فحين يُحسب الشحن بلا موانع تصير المراجعة هي الحالية
  const step = !contactOk ? 1 : quote === null ? 2 : blockers.length > 0 ? 3 : 5;
  const stateOf = (n: number): StepState => (n < step ? 'done' : n === step ? 'current' : 'todo');

  return (
    <div className="sp-page">
      <PageHead title="إتمام الشراء" />
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

      <div className="sp-layout sp-layout--checkout">
        <div className="sp-main">
          <Section n={1} title="بيانات التواصل" state={stateOf(1)}>
            <div className="sp-fields">
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
              <TextInput label="الهاتف" dir="ltr" inputMode="tel" value={address.phone} onChange={set('phone')} />
            </div>
            <p className="sp-note sp-note--xs">
              <Icon name="info" size={14} />
              نرسل رقم الطلب وتحديثات الشحن إلى بيانات التواصل هذه.
            </p>
          </Section>

          <Section n={2} title="عنوان التوصيل" state={stateOf(2)}>
            <div className="sp-fields sp-fields--3">
              <TextInput label="اسم المستلم" value={address.recipientName} onChange={set('recipientName')} />
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
              <TextInput label="المدينة" value={address.city} onChange={set('city')} />
              <div className="sp-fields__wide">
                <TextInput label="الشارع ورقم البناء" value={address.street} onChange={set('street')} />
              </div>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !address.region || !address.city}
              onClick={() => void calculate()}
            >
              احسب الشحن
            </button>
          </Section>

          <Section n={3} title="الشحن لكل متجر" state={stateOf(3)}>
            {quote ? (
              quote.groups.map((g) => {
                const count = g.lines.reduce((sum, l) => sum + l.qty, 0);
                return (
                  <div key={g.vendorId} className={`sp-sub ${g.shipping ? '' : 'sp-sub--warn'}`}>
                    <div className="sp-sub__head">
                      <Icon name="store" size={15} />
                      <span className="sp-sub__name">{g.vendorNameAr}</span>
                      <span className="sp-sub__meta">{pieces(count)}</span>
                    </div>
                    {g.shipping ? (
                      <div className="sp-sub__body">
                        <p className="sp-kv">
                          <span>شحن هذا المتجر — يُشحن منفصلاً</span>
                          <span className="sp-kv__v money num">{g.shipping.formatted}</span>
                        </p>
                      </div>
                    ) : (
                      <p className="sp-sub__warn">
                        <Icon name="alert" size={15} />
                        لم يُحسب شحن هذا المتجر إلى العنوان المدخل — راجع التنبيه أعلى الصفحة.
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="sp-note sp-note--xs">
                <Icon name="truck" size={14} />
                أدخل العنوان واضغط «احسب الشحن» — كل متجر يشحن منفصلاً وبتكلفته.
              </p>
            )}
          </Section>

          <Section n={4} title="الدفع" state={stateOf(4)}>
            <p className="sp-note sp-note--xs">
              <Icon name="info" size={14} />
              بيئة تجريبية: اختر كيف تتصرّف البطاقة.
            </p>
            <fieldset className="sp-fieldset">
              <legend className="visually-hidden">بطاقة الدفع</legend>
              {TEST_CARDS.map((c) => (
                <label key={c.token} className="sp-pay">
                  <input
                    type="radio"
                    name="card"
                    value={c.token}
                    checked={card === c.token}
                    onChange={() => setCard(c.token)}
                  />
                  <Icon name="card" size={19} />
                  <span className="sp-pay__label">{c.label}</span>
                </label>
              ))}
            </fieldset>
            <p className="sp-note">
              <Icon name="lock" size={13} />
              تُعالَج البطاقة عند بوّابة الدفع.
            </p>
          </Section>

          <Section n={5} title="المراجعة" state={stateOf(5)}>
            {quote ? (
              <>
                <p className="sp-review__lead">يصلك طلبك في {shipments(quote.groups.length)}.</p>
                {quote.groups.map((g, i) => (
                  <div key={g.vendorId} className="sp-sub">
                    <div className="sp-sub__head">
                      <span className="sp-sub__n" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="sp-sub__name">{g.vendorNameAr}</span>
                    </div>
                    <ul className="sp-sub__body sp-sub__list">
                      {g.lines.map((l) => {
                        const src = thumbOf(l.imageKey);
                        return (
                          <li key={l.variantId} className="sp-item">
                            <span className="sp-thumb sp-thumb--xs" aria-hidden>
                              {src ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={src} alt="" loading="lazy" width={28} height={28} />
                              ) : (
                                <Icon name="image" size={14} />
                              )}
                            </span>
                            <span className="sp-item__name">
                              {l.nameAr}
                              {l.variantLabel ? ` — ${l.variantLabel}` : ''}
                            </span>
                            <span className="sp-item__qty num">× {l.qty}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </>
            ) : (
              <p className="sp-note sp-note--xs">
                <Icon name="package" size={14} />
                تظهر هنا شحنات طلبك متجراً متجراً بعد حساب الشحن.
              </p>
            )}
          </Section>
        </div>

        <aside className="sp-aside" aria-label="ملخّص الدفع">
          <div className="sp-sum">
            <h2 className="sp-sum__title">ملخّص الدفع</h2>
            {quote ? (
              <dl className="sp-sum__rows">
                <div>
                  <dt>قيمة المنتجات</dt>
                  <dd className="num">{quote.totals.items.formatted}</dd>
                </div>
                {quote.totals.discount.minorUnits !== '0' ? (
                  <div>
                    <dt>الخصم</dt>
                    <dd className="num sp-sum__saving">− {quote.totals.discount.formatted}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>الشحن</dt>
                  <dd className="num">{quote.totals.shipping.formatted}</dd>
                </div>
                <div>
                  <dt>{quote.taxInclusive ? 'الضريبة (مشمولة)' : 'الضريبة'}</dt>
                  <dd className="num">{quote.totals.tax.formatted}</dd>
                </div>
                <div className="sp-sum__total">
                  <dt>الإجمالي</dt>
                  <dd className="money num">{quote.totals.total.formatted}</dd>
                </div>
              </dl>
            ) : (
              <p className="sp-sum__fx">أدخل العنوان واحسب الشحن لترى الإجمالي النهائي.</p>
            )}
          </div>

          <div className="sp-bar">
            {quote ? (
              <span className="sp-bar__total money num" aria-hidden>
                {quote.totals.total.formatted}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn--primary btn--block sp-cta sp-cta--pay"
              disabled={!ready || busy}
              onClick={() => void pay()}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden />
                  جارٍ الدفع…
                </>
              ) : (
                'ادفع'
              )}
            </button>
            <p className="sp-note">
              <Icon name="lock" size={13} />
              لا يُخصم شيء قبل أن تضغط «ادفع»، والمخزون يُحجز لك لحظتها.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
