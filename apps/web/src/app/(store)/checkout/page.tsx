'use client';

import '@/styles/screens/account-area.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, Field, PageHead, Spinner, TextInput } from '@/components/ui';
import { addressLine, addressTitle, type SavedAddress } from '@/lib/addresses';
import { api, ApiError, session } from '@/lib/api';
import { CART_EVENT, cartApi, cartHeaders, type CartView } from '@/lib/cart';
import { RegionSelect } from '@/components/region-select';
import { attemptKey, definitive, endAttempt } from '@/lib/checkout-attempt';
import { digitsOnly } from '@/lib/digits';
import { nameIn, type Locale } from '@/lib/i18n';
import { withNext } from '@/lib/safe-path';
import { imageUrl } from '@/lib/storefront';

interface OrderResult {
  orderId: string;
  orderNumber: string;
  outcome: 'paid' | 'failed' | 'requires_action' | 'awaiting_transfer' | 'pending';
}

/** كيف يدفع المشتري — من الخادم: بطاقة (الوهمي في التطوير) أو تحويل تؤكّده الإدارة */
type PaymentMethod =
  | { method: 'card' }
  | { method: 'bank_transfer'; windowHours: number; ready: boolean; cliq: boolean };

const HERE = '/checkout';

/** بطاقات المزوّد الوهمي — كل واحدة تصنع حالة من حالات البوابة (ADR-012) */
const TEST_CARDS = [
  { token: 'tok_success', label: 'بطاقة تنجح', en: 'Card that succeeds' },
  { token: 'tok_decline', label: 'بطاقة يرفضها البنك', en: 'Card declined by the bank' },
  { token: 'tok_insufficient', label: 'رصيد غير كافٍ', en: 'Insufficient funds' },
  { token: 'tok_timeout', label: 'ينقطع الاتصال بعد الخصم', en: 'Connection drops after the charge' },
  { token: 'tok_timeout_fail', label: 'ينقطع الاتصال بلا خصم', en: 'Connection drops with no charge' },
] as const;

const thumbOf = (key: string | null): string | null => (key ? imageUrl(`/uploads/${key}/thumb.webp`) : null);

/** تمييز العدد بالعربية يتغيّر بالعدد نفسه */
function pieces(n: number, locale: Locale): string {
  if (locale === 'en') return n === 1 ? '1 item' : `${n} items`;
  if (n === 1) return 'قطعة واحدة';
  if (n === 2) return 'قطعتان';
  if (n <= 10) return `${n} قطع`;
  return `${n} قطعة`;
}
function shipments(n: number, locale: Locale): string {
  if (locale === 'en') return n === 1 ? '1 shipment from 1 shop' : `${n} shipments from ${n} shops`;
  if (n === 1) return 'شحنة واحدة من متجر واحد';
  if (n === 2) return 'شحنتين من متجرين';
  if (n <= 10) return `${n} شحنات من ${n} متاجر`;
  return `${n} شحنة من ${n} متجراً`;
}

type StepState = 'done' | 'current' | 'todo';

const BLANK_ADDRESS = { recipientName: '', phone: '', country: 'JO', region: '', city: '', street: '', building: '' };
type AddressForm = typeof BLANK_ADDRESS;

/**
 * ما كتبه المشتري في تبويبه. البطاقة المرفوضة تنقله إلى «لم يكتمل الدفع»، و«أعد المحاولة»
 * تفتح صفحة دفع جديدة — فكان يكتب الهاتف والعنوان من جديد والصفحة تقول «سلّتك كما هي»
 * (J-08، 20 أكتوبر 2026). باسم الحساب: حساب آخر يدخل التبويب نفسه لا يرى عنوان غيره.
 * يُمحى حين يُدفع الطلب أو يُحجز بانتظار التحويل، ويبقى للمرفوض والمعلّق.
 */
const DRAFT_KEY = 'basta.checkoutDraft';

function readDraft(): AddressForm | null {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? 'null') as { owner?: unknown; address?: unknown } | null;
    if (!raw || raw.owner !== session.userId() || typeof raw.address !== 'object' || raw.address === null) return null;
    const saved = raw.address as Record<string, unknown>;
    const draft = { ...BLANK_ADDRESS };
    for (const k of Object.keys(draft) as (keyof AddressForm)[]) if (typeof saved[k] === 'string') draft[k] = saved[k];
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(address: AddressForm | null): void {
  try {
    if (address) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ owner: session.userId(), address }));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // تخزين محجوب (تصفّح خاص صارم): الصفحة تعمل بلا مسوّدة
  }
}

/**
 * عنوان محفوظ في حقول النموذج كما هي: الحي يسبق الشارع في حقل «الشارع ورقم
 * البناء»، والطابق يلحق المبنى. حدود حقول الدفع (200 و 80) لا تُتجاوز —
 * إن طال الدمج بقي الشارع وحده.
 */
function fieldsOf(a: SavedAddress) {
  const street = [a.area, a.street].filter(Boolean).join('، ');
  const building = [a.building, a.floor ? `الطابق ${a.floor}` : null].filter(Boolean).join('، ');
  return {
    recipientName: a.recipientName,
    phone: a.phone,
    country: a.country,
    region: a.region,
    city: a.city,
    street: street.length <= 200 ? street : a.street,
    building: building.length <= 80 ? building : (a.building ?? ''),
  };
}

/** خطوة مرقّمة — الدائرة تصير علامة صحّ حين تكتمل، والحالية بإطار العلامة */
function Section({ n, title, state, children }: { n: number; title: string; state: StepState; children: ReactNode }) {
  const t = useT();
  return (
    <section className="sp-sec" data-state={state} aria-labelledby={`sec-${n}`}>
      <header className="sp-sec__head">
        <span className="sp-sec__num" aria-hidden>
          {state === 'done' ? <Icon name="check" size={15} /> : n}
        </span>
        <div className="sp-sec__titles">
          <h2 className="sp-sec__title" id={`sec-${n}`}>
            {title}
            {state === 'done' ? <span className="visually-hidden">{t(' — مكتملة', ' — completed')}</span> : null}
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
 *
 * **الشراء بحساب** (محسوم 13 أكتوبر 2026): طلب الضيف لا يُتابَع ولا يُلغى ولا
 * يُرجَع، والبريد الذي يحمل رابطه لا يصل بعد. من لم يدخل يرى بوابة الدخول هنا،
 * ويعود إلى الصفحة نفسها بعد الدخول أو التسجيل — والسلة برمزها فتبقى كما هي.
 */
export default function CheckoutPage() {
  const t = useT();
  // الخادم لا يعرف الجلسة: لقطته «لا يُعرف»، فلا تومض بوابة الدخول لمن دخل
  const auth = useSyncExternalStore(
    () => () => undefined,
    () => (session.read() !== null ? 'in' : 'out'),
    () => 'unknown',
  );
  if (auth === 'unknown') return <Spinner label={t('جارٍ فتح الدفع…', 'Opening checkout…')} />;
  if (auth === 'out') return <SignInFirst />;
  return <CheckoutForm />;
}

/** بوابة الدخول — لماذا يُطلب الحساب، وأن السلة لا تضيع */
function SignInFirst() {
  const t = useT();
  return (
    <div className="sp-page sp-page--narrow">
      <PageHead title={t('إتمام الشراء', 'Checkout')} />
      <section className="sp-hero sp-hero--info">
        <span className="sp-hero__icon" aria-hidden>
          <Icon name="user" size={28} />
        </span>
        <h2 className="sp-hero__title">{t('ادخل لتكمل الشراء', 'Sign in to complete your purchase')}</h2>
        <p className="sp-hero__text">
          {t(
            'سلّتك محفوظة كما هي. بحسابك تتابع طلبك من أي جهاز، وتلغيه أو ترجعه، وتراسل البائع — وتعود إلى هنا بعد الدخول مباشرةً.',
            'Your cart is saved as it is. With an account you can track your order from any device, cancel or return it, and message the seller — and you come straight back here after signing in.',
          )}
        </p>
        <div className="sp-hero__actions">
          <Link className="btn btn--primary" href={withNext('/login', HERE)}>
            {t('ادخل', 'Sign in')}
          </Link>
          <Link className="btn btn--secondary" href={withNext('/register', HERE)}>
            {t('أنشئ حساباً', 'Create an account')}
          </Link>
          <Link className="btn btn--ghost" href="/cart">
            {t('عُد إلى السلة', 'Back to cart')}
          </Link>
        </div>
      </section>
    </div>
  );
}

function CheckoutForm() {
  // البوابة فوقه لا تعرضه إلا لمن دخل
  const router = useRouter();
  const t = useT();
  const locale = useLocale();

  // الصفحة لا تُرسم في الخادم (البوابة فوقها تنتظر الجلسة)، فقراءة التبويب هنا آمنة
  const [restored] = useState(readDraft);
  const [address, setAddress] = useState<AddressForm>(() => restored ?? BLANK_ADDRESS);
  const [card, setCard] = useState<string>('tok_success');
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  /**
   * تعذّر جلب طريقة الدفع. كان الخطأ يُبتلع فيبقى «جارٍ تحميل طريقة الدفع…» للأبد و«ادفع»
   * معطّلاً بلا سبب (CHK-061، 31 أكتوبر 2026) — الآن يُقال، و«أعد المحاولة» يجلبها ثانيةً
   */
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentAttempt, setPaymentAttempt] = useState(0);
  const transfer = payment?.method === 'bank_transfer' ? payment : null;
  /**
   * الإجمالي محسوب لعنوان بعينه: الشحن والضريبة ببلده ومنطقته ومدينته. تغيير
   * أيٍّ منها بعد «احسب الشحن» كان يُبقي الإجمالي القديم معروضاً تحت «ادفع»،
   * والخادم يسعّر بالعنوان الجديد — فيُخصم مبلغ لم يره المشتري. الحساب يُحفظ
   * مع مفتاح عنوانه، ولا يُعدّ حساباً لعنوان غيره.
   */
  const [quoted, setQuoted] = useState<{ key: string; view: CartView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // العناوين المحفوظة للداخل — تملأ الحقول نفسها ولا تغيّر شيئاً في الدفع
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  const addressKey = [address.country, address.region.trim(), address.city.trim()].join('|');
  const quote = quoted && quoted.key === addressKey ? quoted.view : null;
  /** حُسب الشحن ثم تغيّر العنوان — يُقال للمشتري لماذا اختفى الإجمالي */
  const stale = quoted !== null && quote === null;
  const priced = (view: CartView, a: typeof address) => {
    setQuoted({ key: [a.country, a.region.trim(), a.city.trim()].join('|'), view });
    setBlockers(view.blockers);
  };

  const set = (key: keyof typeof address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAddress((a) => ({ ...a, [key]: e.target.value }));
    // تعديل يدوي بعد الاختيار يجعل الحقول عنواناً آخر — لا تبقى البطاقة مختارة وهي لا تطابق
    if (key !== 'phone') setPicked(null);
  };

  const pick = (a: SavedAddress) => {
    setAddress(fieldsOf(a));
    setPicked(a.id);
  };

  const pickNew = () => {
    setAddress((a) => ({ ...a, recipientName: '', region: '', city: '', street: '', building: '' }));
    setPicked('new');
  };

  useEffect(() => {
    let alive = true;
    api<PaymentMethod>('/checkout/payment-method')
      .then((m) => {
        if (alive) setPayment(m);
      })
      .catch((err: unknown) => {
        if (alive) setPaymentError(err instanceof Error ? err.message : t('تعذّر الاتصال بالخادم.', "Couldn't reach the server."));
      });
    return () => {
      alive = false;
    };
  }, [paymentAttempt, t]);

  useEffect(() => {
    let alive = true;
    api<{ items: SavedAddress[] }>('/me/addresses')
      .then(({ items }) => {
        if (!alive || items.length === 0) return;
        setSaved(items);
        // الافتراضي يُملأ مسبقاً ما دامت الحقول فارغة — لا يُكتب فوق ما كتبه المشتري، ولا فوق مسوّدته
        const def = items.find((i) => i.isDefault);
        if (!def || restored) return;
        setAddress((cur) =>
          cur.recipientName || cur.region || cur.city || cur.street ? cur : { ...fieldsOf(def), phone: cur.phone || def.phone },
        );
        setPicked((p) => p ?? def.id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [restored]);

  // كل تعديل يُحفظ في التبويب — يعود بعد «أعد المحاولة» أو إعادة تحميل الصفحة
  useEffect(() => writeDraft(address), [address]);

  async function calculate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const q = await cartApi.quote({ country: address.country, region: address.region, city: address.city });
      priced(q, address);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّر حساب الشحن.', "Couldn't calculate shipping."));
    } finally {
      setBusy(false);
    }
  }

  async function pay(): Promise<void> {
    if (!quote) return;
    setBusy(true);
    setError(null);
    const cart = cartHeaders();
    const key = attemptKey(cart['x-cart-token'] ?? null);
    let leaving = false;
    try {
      const result = await api<OrderResult>('/checkout', {
        method: 'POST',
        headers: { ...cart, 'idempotency-key': key },
        body: {
          address: {
            ...address,
            ...(address.building ? {} : { building: undefined }),
          },
          paymentToken: transfer ? 'bank_transfer' : card,
          // ما يراه تحت «ادفع» — الخادم لا يخصم غيره
          expectedTotal: quote.totals.total.minorUnits,
          expectedCurrency: quote.currency,
        },
      });
      // الخادم أجاب بطلب معروف — مدفوعاً أو مرفوضاً أو معلّقاً تحسمه المصالحة.
      // الشراء التالية (بطاقة أخرى، أو سلة جديدة) محاولة جديدة بمفتاح جديد
      endAttempt();
      // دُفع أو حُجز بانتظار التحويل: انتهى هذا الشراء، والتالي يبدأ من العنوان المحفوظ لا من مسوّدته
      if (result.outcome === 'paid' || result.outcome === 'awaiting_transfer') writeDraft(null);
      // الخادم فرّغ السلة (دُفع الطلب أو حُجز بانتظار التحويل) — الرأس يعيد قراءة عدّادها
      window.dispatchEvent(new Event(CART_EVENT));
      leaving = true;
      router.push(`/orders/${result.orderNumber}`);
    } catch (err) {
      // انتهت الجلسة ولم يُجدَّدها الرمز: لا طلب أُنشئ، فيعود بعد الدخول بالمحاولة نفسها
      if (err instanceof ApiError && err.status === 401) {
        router.push(withNext('/login', HERE));
        return;
      }
      if (err instanceof ApiError && Array.isArray(err.details?.['blockers'])) {
        setBlockers(err.details['blockers'] as string[]);
      }
      // تغيّر الإجمالي في الخادم (سعر، شحن، كوبون، سلة من تبويب آخر): يُعاد
      // الحساب ليرى الجديد، ولا يُدفع حتى يضغط «ادفع» عليه
      if (err instanceof ApiError && err.details?.['reason'] === 'TOTAL_CHANGED') {
        try {
          priced(await cartApi.quote({ country: address.country, region: address.region, city: address.city }), address);
        } catch {
          setQuoted(null);
        }
      }
      // رفض قاطع قبل أي مال ينهي المحاولة؛ 502/504 وانقطاع الشبكة يُبقيان المفتاح
      // (checkout-attempt) — «ادفع» ثانيةً يعيد الطلب نفسه إن كان خُصم، لا يدفع مرتين
      if (definitive(err)) endAttempt();
      setError(err instanceof Error ? err.message : t('تعذّر إتمام الطلب.', "Couldn't place the order."));
    } finally {
      // أجاب الخادم بطلب والصفحة تنتقل إليه: «ادفع» يبقى معطّلاً حتى تنتقل. كان يعود فعّالاً
      // أثناء الانتقال، فضغطة ثانية أرسلت محاولة بمفتاح جديد على سلة فرغت — «السلة فارغة.»
      // تحت طلب دُفع للتوّ (J-08، 20 أكتوبر 2026)
      if (!leaving) setBusy(false);
    }
  }

  const contactOk = address.phone.trim() !== '';
  /**
   * ما يرفضه الخادم لا يُرسل: الاسم والشارع حرفان فأكثر، والهاتف سبعة أرقام. كان «ادفع»
   * يعمل والحقول فارغة، فيعود ردّ تحقّق من الخادم بدل أن تقول الصفحة ماذا ينقص.
   */
  const missing = [
    address.recipientName.trim().length < 2 ? t('اسم المستلم', 'Recipient name') : null,
    address.street.trim().length < 2 ? t('الشارع ورقم البناء', 'Street and building number') : null,
    digitsOnly(address.phone).length < 7 ? t('الهاتف', 'Phone') : null,
  ].filter((m): m is string => m !== null);
  // التحويل بلا بيانات حساب مضبوطة يُرفض في الخادم — الزر لا يَعِد بما لن يقبله
  const ready =
    quote !== null && blockers.length === 0 && missing.length === 0 && payment !== null && (!transfer || transfer.ready);

  // الخطوة الحالية: أوّل خطوة لم تكتمل. الدفع مختار دائماً، فحين يُحسب الشحن بلا موانع تصير المراجعة هي الحالية
  const step = !contactOk ? 1 : quote === null ? 2 : blockers.length > 0 ? 3 : 5;
  const stateOf = (n: number): StepState => (n < step ? 'done' : n === step ? 'current' : 'todo');

  return (
    <div className="sp-page">
      <PageHead title={t('إتمام الشراء', 'Checkout')} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {/* موانع حساب قديم لعنوان تغيّر لا تُعرض — تُحسب من جديد مع الشحن */}
      {blockers.length > 0 && !stale ? (
        <Alert tone="warning" title={t('قبل الدفع', 'Before you pay')}>
          <ul className="blockers">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="sp-layout sp-layout--checkout">
        <div className="sp-main">
          <Section n={1} title={t('بيانات التواصل', 'Contact details')} state={stateOf(1)}>
            <div className="sp-fields">
              <TextInput label={t('الهاتف', 'Phone')} dir="ltr" inputMode="tel" value={address.phone} onChange={set('phone')} />
            </div>
            <p className="sp-note sp-note--xs">
              <Icon name="info" size={14} />
              {t('نرسل رقم الطلب وتحديثات الشحن إلى بيانات التواصل هذه.', 'We send the order number and shipping updates to these contact details.')}
            </p>
          </Section>

          <Section n={2} title={t('عنوان التوصيل', 'Delivery address')} state={stateOf(2)}>
            {saved.length > 0 ? (
              <fieldset className="aa-pick-set">
                <legend>{t('عناوينك المحفوظة', 'Your saved addresses')}</legend>
                <div className="aa-picks">
                  {saved.map((a) => (
                    <label key={a.id} className="aa-pick">
                      <span className="aa-pick__head">
                        <input
                          type="radio"
                          name="saved-address"
                          value={a.id}
                          checked={picked === a.id}
                          onChange={() => pick(a)}
                          aria-labelledby={`pick-${a.id}`}
                          aria-describedby={`pick-${a.id}-line`}
                        />
                        <span className="aa-pick__label" id={`pick-${a.id}`}>
                          {addressTitle(a)}
                          {a.isDefault ? <span className="visually-hidden">{t(' — الافتراضي', ' — default')}</span> : null}
                        </span>
                      </span>
                      <span className="aa-pick__line" id={`pick-${a.id}-line`}>
                        {addressLine(a, locale)}
                      </span>
                      <bdi className="aa-pick__phone num" dir="ltr">
                        {a.phone}
                      </bdi>
                    </label>
                  ))}
                  <label className="aa-pick aa-pick--new">
                    <input
                      type="radio"
                      name="saved-address"
                      value="new"
                      checked={picked === 'new'}
                      onChange={pickNew}
                    />
                    <span className="aa-pick__head">
                      <Icon name="plus" size={20} />
                      <span className="aa-pick__label">{t('عنوان جديد', 'New address')}</span>
                    </span>
                  </label>
                </div>
              </fieldset>
            ) : null}
            <div className="sp-fields sp-fields--3">
              <TextInput label={t('اسم المستلم', 'Recipient name')} value={address.recipientName} onChange={set('recipientName')} />
              <Field label={t('البلد', 'Country')}>
                {(props) => (
                  <select
                    className="field__control"
                    {...props}
                    value={address.country}
                    onChange={(e) => setAddress((a) => ({ ...a, country: e.target.value, region: '' }))}
                  >
                    <option value="JO">{t('الأردن', 'Jordan')}</option>
                    <option value="SA">{t('السعودية', 'Saudi Arabia')}</option>
                    <option value="AE">{t('الإمارات', 'United Arab Emirates')}</option>
                    <option value="KW">{t('الكويت', 'Kuwait')}</option>
                    <option value="EG">{t('مصر', 'Egypt')}</option>
                  </select>
                )}
              </Field>
              <RegionSelect country={address.country} value={address.region} onChange={(v) => setAddress((a) => ({ ...a, region: v }))} />
              <TextInput label={t('المدينة', 'City')} value={address.city} onChange={set('city')} />
              <div className="sp-fields__wide">
                <TextInput label={t('الشارع ورقم البناء', 'Street and building number')} value={address.street} onChange={set('street')} />
              </div>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !address.region || !address.city}
              onClick={() => void calculate()}
            >
              {t('احسب الشحن', 'Calculate shipping')}
            </button>
            {stale ? (
              <p className="sp-note" role="status">
                <Icon name="info" size={14} />
                {t(
                  'غيّرت العنوان — احسب الشحن من جديد لترى الإجمالي لهذا العنوان قبل الدفع.',
                  'You changed the address — calculate shipping again to see the total for this address before you pay.',
                )}
              </p>
            ) : null}
          </Section>

          <Section n={3} title={t('الشحن لكل متجر', 'Shipping per shop')} state={stateOf(3)}>
            {quote ? (
              quote.groups.map((g) => {
                const count = g.lines.reduce((sum, l) => sum + l.qty, 0);
                return (
                  <div key={g.vendorId} className={`sp-sub ${g.shipping ? '' : 'sp-sub--warn'}`}>
                    <div className="sp-sub__head">
                      <Icon name="store" size={15} />
                      <span className="sp-sub__name">{nameIn(locale, { nameAr: g.vendorNameAr, nameEn: g.vendorNameEn })}</span>
                      <span className="sp-sub__meta">{pieces(count, locale)}</span>
                    </div>
                    {g.shipping ? (
                      <div className="sp-sub__body">
                        <p className="sp-kv">
                          <span>{t('شحن هذا المتجر — يُشحن منفصلاً', 'Shipping for this shop — ships separately')}</span>
                          <span className="sp-kv__v money num">{g.shipping.formatted}</span>
                        </p>
                      </div>
                    ) : (
                      <p className="sp-sub__warn">
                        <Icon name="alert" size={15} />
                        {t(
                          'لم يُحسب شحن هذا المتجر إلى العنوان المدخل — راجع التنبيه أعلى الصفحة.',
                          "Shipping for this shop couldn't be calculated to the address entered — see the alert at the top of the page.",
                        )}
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="sp-note sp-note--xs">
                <Icon name="truck" size={14} />
                {t(
                  'أدخل العنوان واضغط «احسب الشحن» — كل متجر يشحن منفصلاً وبتكلفته.',
                  'Enter the address and press “Calculate shipping” — each shop ships separately, at its own cost.',
                )}
              </p>
            )}
          </Section>

          <Section n={4} title={t('الدفع', 'Payment')} state={stateOf(4)}>
            {payment === null && paymentError ? (
              <Alert tone="danger" title={t('تعذّر تحميل طريقة الدفع', "Couldn't load the payment method")}>
                <p>
                  {paymentError} {t('عنوانك والشحن المحسوب باقيان.', 'Your address and calculated shipping are kept.')}
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setPaymentError(null);
                    setPaymentAttempt((n) => n + 1);
                  }}
                >
                  <Icon name="refresh" size={15} />
                  {t('أعد المحاولة', 'Try again')}
                </button>
              </Alert>
            ) : payment === null ? (
              <Spinner label={t('جارٍ تحميل طريقة الدفع…', 'Loading payment method…')} />
            ) : transfer ? (
              <>
                <div className="sp-pay sp-pay--static">
                  <Icon name="wallet" size={19} />
                  <span className="sp-pay__label">
                    {transfer.cliq ? t('تحويل عبر كليك أو تحويل بنكي', 'CliQ or bank transfer') : t('تحويل بنكي', 'Bank transfer')}
                  </span>
                </div>
                {transfer.ready ? (
                  <ol className="sp-transfer__steps">
                    <li>
                      {t(
                        `تضغط «أكّد الطلب» فنحجز لك القطع ${transfer.windowHours} ساعة — بلا أي خصم.`,
                        `You press “Confirm order” and we reserve the items for you for ${transfer.windowHours} ${transfer.windowHours === 1 ? 'hour' : 'hours'} — with no charge.`,
                      )}
                    </li>
                    <li>
                      {t(
                        'نعرض لك المبلغ وبيانات الحساب، فتحوّل من تطبيق بنكك وتكتب رقم الطلب في الملاحظة.',
                        'We show you the amount and the account details; you transfer from your banking app and write the order number in the note.',
                      )}
                    </li>
                    <li>
                      {t(
                        'نؤكّد وصول التحويل ونرسل طلبك إلى المتاجر، ونبلغك حينها.',
                        'We confirm the transfer has arrived, send your order to the shops, and let you know.',
                      )}
                    </li>
                  </ol>
                ) : (
                  <Alert tone="warning">
                    {t(
                      'الدفع غير متاح الآن — نضبط بيانات التحويل. سلّتك محفوظة، جرّب بعد قليل.',
                      "Payment isn't available right now — we're setting up the transfer details. Your cart is saved; try again shortly.",
                    )}
                  </Alert>
                )}
              </>
            ) : (
              <>
                <p className="sp-note sp-note--xs">
                  <Icon name="info" size={14} />
                  {t('بيئة تجريبية: اختر كيف تتصرّف البطاقة.', 'Test environment: choose how the card behaves.')}
                </p>
                <fieldset className="sp-fieldset">
                  <legend className="visually-hidden">{t('بطاقة الدفع', 'Payment card')}</legend>
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
                      <span className="sp-pay__label">{t(c.label, c.en)}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="sp-note">
                  <Icon name="lock" size={13} />
                  {t('تُعالَج البطاقة عند بوّابة الدفع.', 'The card is processed by the payment gateway.')}
                </p>
              </>
            )}
          </Section>

          <Section n={5} title={t('المراجعة', 'Review')} state={stateOf(5)}>
            {quote ? (
              <>
                <p className="sp-review__lead">
                  {t(
                    `يصلك طلبك في ${shipments(quote.groups.length, locale)}.`,
                    `Your order arrives in ${shipments(quote.groups.length, locale)}.`,
                  )}
                </p>
                {quote.groups.map((g, i) => (
                  <div key={g.vendorId} className="sp-sub">
                    <div className="sp-sub__head">
                      <span className="sp-sub__n" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="sp-sub__name">{nameIn(locale, { nameAr: g.vendorNameAr, nameEn: g.vendorNameEn })}</span>
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
                              {nameIn(locale, l)}
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
                {t(
                  'تظهر هنا شحنات طلبك متجراً متجراً بعد حساب الشحن.',
                  "Your order's shipments appear here, shop by shop, once shipping is calculated.",
                )}
              </p>
            )}
          </Section>
        </div>

        <aside className="sp-aside" aria-label={t('ملخّص الدفع', 'Payment summary')}>
          <div className="sp-sum">
            <h2 className="sp-sum__title">{t('ملخّص الدفع', 'Payment summary')}</h2>
            {quote ? (
              <dl className="sp-sum__rows">
                <div>
                  <dt>{t('قيمة المنتجات', 'Items')}</dt>
                  <dd className="num">{quote.totals.items.formatted}</dd>
                </div>
                {quote.totals.discount.minorUnits !== '0' ? (
                  <div>
                    <dt>
                      {t('الخصم', 'Discount')}
                      {quote.couponCode ? <> (<bdi>{quote.couponCode}</bdi>)</> : null}
                    </dt>
                    <dd className="num sp-sum__saving">− {quote.totals.discount.formatted}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t('الشحن', 'Shipping')}</dt>
                  <dd className="num">{quote.totals.shipping.formatted}</dd>
                </div>
                <div>
                  <dt>{quote.taxInclusive ? t('الضريبة (مشمولة)', 'Tax (included)') : t('الضريبة', 'Tax')}</dt>
                  <dd className="num">{quote.totals.tax.formatted}</dd>
                </div>
                <div className="sp-sum__total">
                  <dt>{t('الإجمالي', 'Total')}</dt>
                  <dd className="money num">{quote.totals.total.formatted}</dd>
                </div>
              </dl>
            ) : (
              <p className="sp-sum__fx">
                {t('أدخل العنوان واحسب الشحن لترى الإجمالي النهائي.', 'Enter the address and calculate shipping to see the final total.')}
              </p>
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
                  {transfer ? t('جارٍ تأكيد الطلب…', 'Confirming order…') : t('جارٍ الدفع…', 'Paying…')}
                </>
              ) : transfer ? (
                t('أكّد الطلب', 'Confirm order')
              ) : (
                t('ادفع', 'Pay')
              )}
            </button>
            {quote && missing.length > 0 ? (
              <p className="sp-note sp-note--warn" role="status">
                <Icon name="info" size={13} />
                {t(`أكمل قبل التأكيد: ${missing.join('، ')}.`, `Complete before confirming: ${missing.join(', ')}.`)}
              </p>
            ) : null}
            <p className="sp-note">
              <Icon name="lock" size={13} />
              {transfer
                ? t(
                    `لا يُخصم شيء — تحوّل أنت المبلغ بعد التأكيد، والقطع محجوزة لك ${transfer.windowHours} ساعة.`,
                    `Nothing is charged — you transfer the amount after confirming, and the items stay reserved for you for ${transfer.windowHours} ${transfer.windowHours === 1 ? 'hour' : 'hours'}.`,
                  )
                : t(
                    'لا يُخصم شيء قبل أن تضغط «ادفع»، والمخزون يُحجز لك لحظتها.',
                    'Nothing is charged until you press “Pay”, and the stock is reserved for you at that moment.',
                  )}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
