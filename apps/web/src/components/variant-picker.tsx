'use client';

import Link from 'next/link';
import { Fragment, createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { cartApi } from '@/lib/cart';
import type { ProductPage } from '@/lib/storefront';

type Variant = ProductPage['variants'][number];

/** «بقي N فقط» تحت هذا العدد — ما فوقه «متوفّر» */
const LOW_STOCK = 3;

/**
 * المتغيّر المختار مشتركاً بين الاختيار والمعرض — يفصل بينهما في الصفحة محتوى خادم
 * (الاسم والبائع)، فالسياق يلفّهما معاً بلا نقل الصفحة كلها إلى العميل.
 */
const SelectionContext = createContext<{ selected: string; setSelected: (id: string) => void } | null>(null);

export function ProductSelection({ initial, children }: { initial: string; children: ReactNode }) {
  const [selected, setSelected] = useState(initial);
  const value = useMemo(() => ({ selected, setSelected }), [selected]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * اختيار المتغيّر — لون ومقاس.
 *
 * يُصيَّر في الخادم بالمتغيّر الأرخص محدّداً، فالسعر في مصدر HTML حقيقي لا
 * «اختر خياراً». والخيار غير المتوفّر يُعرض معطّلاً لا مخفيّاً: المشتري الذي
 * لا يرى مقاسه يظنّ أن المتجر لا يبيعه أصلاً، لا أنه نفد.
 *
 * `actions` أزرار أيقونة بجانب «أضف إلى السلة» في الصفّ نفسه (زرّ «قارن»)
 * — تبقى ظاهرة حين ينفد الخيار أيضاً.
 */
export function VariantPicker({ variants, actions }: { variants: Variant[]; actions?: ReactNode }) {
  // داخل ProductSelection يشارك المعرضَ اختيارَه (فيقفز إلى صورة اللون)، وخارجه حالة محلية
  const shared = useContext(SelectionContext);
  const [own, setOwn] = useState<string>(variants[0]?.id ?? '');
  const selected = shared?.selected ?? own;
  const setSelected = shared?.setSelected ?? setOwn;

  const axes = useMemo(() => {
    const map = new Map<string, { nameAr: string; values: Map<string, { valueAr: string; hexColor: string | null }> }>();
    for (const v of variants) {
      for (const o of v.options) {
        const axis = map.get(o.attributeId) ?? { nameAr: o.nameAr, values: new Map() };
        axis.values.set(o.valueId, { valueAr: o.valueAr, hexColor: o.hexColor });
        map.set(o.attributeId, axis);
      }
    }
    return [...map.entries()];
  }, [variants]);

  const current = variants.find((v) => v.id === selected) ?? variants[0];
  if (!current) return null;

  const chosen = new Map(current.options.map((o) => [o.attributeId, o.valueId]));

  function pick(attributeId: string, valueId: string): void {
    const want = new Map(chosen);
    want.set(attributeId, valueId);
    // أقرب متغيّر يطابق كل الاختيارات، وإلا أوّل ما يطابق الخيار المضغوط
    const exact = variants.find((v) => v.options.every((o) => want.get(o.attributeId) === o.valueId));
    const loose = variants.find((v) => v.options.some((o) => o.attributeId === attributeId && o.valueId === valueId));
    const next = exact ?? loose;
    if (next) setSelected(next.id);
  }

  const discounted =
    current.compareAtPrice && BigInt(current.compareAtPrice.minorUnits) > BigInt(current.price.minorUnits);
  // نسبة الخصم من المبلغين نفسيهما — عرض فقط، لا حساب مال
  const discountPct =
    discounted && current.compareAtPrice
      ? Math.round((1 - Number(current.price.minorUnits) / Number(current.compareAtPrice.minorUnits)) * 100)
      : 0;

  const soldOut = current.available <= 0;
  const stockTone = soldOut ? 'danger' : current.available <= LOW_STOCK ? 'warning' : 'success';
  // ST-08: حين ينفد الخيار المختار نقول ما المتوفّر الآن بدل طريق مسدود
  const others = soldOut
    ? variants.filter((v) => v.available > 0 && v.options.length > 0)
    : [];

  return (
    <div className="sd-buybox">
      <div className="sd-price">
        <span className="money num sd-price__now">{current.price.formatted}</span>
        {discounted && current.compareAtPrice ? (
          <>
            <s className="num sd-price__was">{current.compareAtPrice.formatted}</s>
            {discountPct > 0 ? (
              <span className="sd-price__off">
                <span className="num">−{discountPct}%</span>
              </span>
            ) : null}
          </>
        ) : null}
        {current.originalPrice ? (
          // ما سعّر به المتجر — المحوَّل أعلاه بسعر صرف اليوم، وهو ما يُدفع
          <span className="sd-price__store">
            <span className="num">{current.originalPrice.formatted}</span> بعملة المتجر
          </span>
        ) : null}
      </div>

      {axes.map(([attributeId, axis]) => {
        const isColor = [...axis.values.values()].some((v) => v.hexColor);
        return (
          <fieldset key={attributeId} className="sd-axis">
            <legend className="sd-axis__label">
              <span className="sd-axis__name">{axis.nameAr}</span>
              <span className="sd-axis__value">{axis.values.get(chosen.get(attributeId) ?? '')?.valueAr}</span>
            </legend>
            <div className="sd-axis__opts">
              {[...axis.values.entries()].map(([valueId, value]) => {
                const reachable = variants.some(
                  (v) =>
                    v.available > 0 &&
                    v.options.some((o) => o.attributeId === attributeId && o.valueId === valueId),
                );
                const on = chosen.get(attributeId) === valueId;
                return isColor && value.hexColor ? (
                  <button
                    key={valueId}
                    type="button"
                    className="sd-swatch"
                    aria-pressed={on}
                    aria-label={reachable ? value.valueAr : `${value.valueAr} — نفد`}
                    data-unavailable={!reachable}
                    onClick={() => pick(attributeId, valueId)}
                    title={reachable ? value.valueAr : `${value.valueAr} — نفد`}
                    style={{ background: value.hexColor }}
                  >
                    {on ? (
                      <span className="sd-swatch__check" aria-hidden>
                        <Icon name="check" size={13} />
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <button
                    key={valueId}
                    type="button"
                    className="sd-size"
                    aria-pressed={on}
                    data-unavailable={!reachable}
                    onClick={() => pick(attributeId, valueId)}
                    title={reachable ? value.valueAr : `${value.valueAr} — نفد`}
                  >
                    {value.hexColor ? (
                      <span className="sd-size__dot" style={{ background: value.hexColor }} aria-hidden />
                    ) : null}
                    {value.valueAr}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <p className="sd-stock" data-tone={stockTone} role="status">
        <span className="sd-stock__dot" aria-hidden />
        {soldOut
          ? 'هذا الخيار نفد'
          : current.available <= LOW_STOCK
            ? `بقي ${current.available} فقط`
            : 'متوفّر في المخزون'}
      </p>

      <AddToCart key={current.id} variantId={current.id} available={current.available} actions={actions} />

      {others.length > 0 ? (
        <p className="sd-others">
          متوفّر الآن:{' '}
          {others.map((v, i) => (
            <Fragment key={v.id}>
              {i > 0 ? '، ' : null}
              {/* الخيار معزول: «S» اللاتينية كانت تسحب «(5)» إلى مقطعها فيُقرأ العدد قبل المقاس (DISC-053) */}
              <bdi>{v.options.map((o) => o.valueAr).join(' · ')}</bdi> ({v.available})
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function AddToCart({
  variantId,
  available,
  actions,
}: {
  variantId: string;
  available: number;
  actions?: ReactNode;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'added' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const disabled = available <= 0;

  async function add(): Promise<void> {
    setState('busy');
    setMessage(null);
    try {
      await cartApi.add(variantId, qty);
      setState('added');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'تعذّرت الإضافة إلى السلة.');
    }
  }

  return (
    <div className="sd-buy">
      <div className="sd-buy__row">
        {disabled ? null : (
          <div className="sd-qty" role="group" aria-label="الكمية">
            <button
              type="button"
              className="sd-qty__btn"
              aria-label="أنقص"
              disabled={qty <= 1}
              onClick={() => setQty((n) => Math.max(1, n - 1))}
            >
              <Icon name="minus" size={17} />
            </button>
            <span className="num sd-qty__val" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              className="sd-qty__btn"
              aria-label="زد"
              disabled={qty >= available}
              onClick={() => setQty((n) => Math.min(available, n + 1))}
            >
              <Icon name="plus" size={17} />
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn btn--primary sd-buy__add"
          disabled={disabled || state === 'busy'}
          onClick={() => void add()}
        >
          <Icon name="cart" size={19} />
          {disabled ? 'نفد من المخزون' : state === 'busy' ? 'جارٍ الإضافة…' : 'أضف إلى السلة'}
        </button>
        {actions}
      </div>
      {!disabled && qty >= available && available > 1 ? (
        <p className="sd-buy__hint">
          <Icon name="info" size={14} />
          بلغت الحد المتاح
        </p>
      ) : null}
      {state === 'added' ? (
        <p className="sd-buy__done" role="status">
          <Icon name="check-circle" size={15} />
          أُضيف إلى سلّتك. <Link href="/cart">اذهب إلى السلة</Link>
        </p>
      ) : null}
      {message ? (
        <p className="field__error" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export interface GalleryImage {
  id: string;
  alt: string;
  full: string;
  thumb: string;
  avif: string | null;
  medium: string | null;
  mediumAvif: string | null;
  /** للمتغيّر بعينه أو لقيمة خيار (اللون الأحمر) — أو للجميع */
  variantId?: string | null;
  optionValueId?: string | null;
}

/** أوّل صورة تخصّ المتغيّر: له بعينه، ثم لإحدى قيمه (الأحمر بأي مقاس) — أو -1 */
export function imageIndexFor(images: readonly GalleryImage[], variantId: string, valueIds: readonly string[]): number {
  const exact = images.findIndex((img) => img.variantId === variantId);
  if (exact >= 0) return exact;
  return images.findIndex((img) => !!img.optionValueId && valueIds.includes(img.optionValueId));
}

/**
 * الصورة بعد تغيير الاختيار: صورة المتغيّر إن وُجدت. وإلا فالصورة العامة التي يتصفّحها
 * المشتري تبقى، أما صورة مربوطة بلون آخر فتعود إلى أول صورة عامة — لا أحمر بصورة زرقاء.
 */
export function nextImageIndex(
  images: readonly GalleryImage[],
  current: number,
  variantId: string,
  valueIds: readonly string[],
): number {
  const own = imageIndexFor(images, variantId, valueIds);
  if (own >= 0) return own;
  const shown = images[current];
  if (!shown?.variantId && !shown?.optionValueId) return current;
  return Math.max(0, images.findIndex((img) => !img.variantId && !img.optionValueId));
}

/**
 * معرض صور المنتج — ST-07: مصغّرات في عمود وصورة كبيرة 4:5.
 *
 * يُصيَّر في الخادم بالغلاف محدّداً، فالصورة الكبيرة (LCP) في مصدر HTML
 * بأولوية جلب عالية؛ المصغّرات وحدها تحتاج السكربت لتبدّل الصورة.
 *
 * داخل ProductSelection: حين يختار المشتري لوناً تقفز الصورة الكبيرة إلى صورته إن ربطها
 * البائع به. الغلاف يبقى أول ما يُرى — القفز عند تغيير الاختيار لا عند التحميل.
 */
export function ProductGallery({
  images,
  name,
  soldOut,
  variantValues = {},
}: {
  images: GalleryImage[];
  name: string;
  soldOut: boolean;
  /** قيم خيارات كل متغيّر — لمطابقة صورة القيمة بالمتغيّر المختار */
  variantValues?: Readonly<Record<string, readonly string[]>>;
}) {
  const [index, setIndex] = useState(0);
  const shared = useContext(SelectionContext);
  const [seen, setSeen] = useState(shared?.selected ?? '');
  // ضبط الحالة حين يتغيّر الاختيار (أثناء التصيير لا في أثر): اختيار لون له صورة يقفز إليها،
  // ولون بلا صورة يُبقي الصورة العامة التي يتصفّحها المشتري ويترك صورة لون آخر
  if (shared && shared.selected !== seen) {
    setSeen(shared.selected);
    setIndex(nextImageIndex(images, index, shared.selected, variantValues[shared.selected] ?? []));
  }
  const shown = images[index] ?? images[0];

  return (
    <div className={images.length > 1 ? 'sd-gallery sd-gallery--thumbs' : 'sd-gallery'}>
      {images.length > 1 ? (
        <div className="sd-gallery__thumbs" role="group" aria-label="صور المنتج">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              className="sd-gallery__thumb"
              aria-pressed={i === index}
              aria-label={`صورة ${i + 1} من ${images.length}`}
              onClick={() => setIndex(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumb} alt="" loading="lazy" width={84} height={84} />
            </button>
          ))}
        </div>
      ) : null}

      <div className="sd-gallery__stage">
        {shown ? (
          /*
           * صورة الغلاف هي LCP الصفحة (المرحلة 12): الهاتف يأخذ 800 بكسل
           * بصيغة AVIF، والشاشة الواسعة 1600، وWebP احتياط لما لا يقرأ AVIF.
           * أولوية جلب عالية — تبدأ قبل السكربتات لا بعدها.
           */
          <picture key={shown.id}>
            {shown.mediumAvif ? <source media="(max-width: 767px)" type="image/avif" srcSet={shown.mediumAvif} /> : null}
            {shown.medium ? <source media="(max-width: 767px)" type="image/webp" srcSet={shown.medium} /> : null}
            {shown.avif ? <source type="image/avif" srcSet={shown.avif} /> : null}
            <img
              src={shown.full}
              alt={shown.alt}
              width={800}
              height={1000}
              fetchPriority={index === 0 ? 'high' : 'auto'}
              decoding="async"
            />
          </picture>
        ) : (
          <span className="sd-gallery__placeholder" aria-hidden>
            {name.slice(0, 1)}
          </span>
        )}
        {soldOut ? <span className="sd-gallery__flag">نفد من المخزون</span> : null}
        {images.length > 1 ? (
          <span className="num sd-gallery__count" aria-hidden>
            {index + 1} / {images.length}
          </span>
        ) : null}
      </div>
    </div>
  );
}
