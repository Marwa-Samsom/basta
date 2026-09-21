'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cartApi } from '@/lib/cart';
import type { ProductPage } from '@/lib/storefront';

type Variant = ProductPage['variants'][number];

/**
 * اختيار المتغيّر — لون ومقاس.
 *
 * يُصيَّر في الخادم بالمتغيّر الأرخص محدّداً، فالسعر في مصدر HTML حقيقي لا
 * «اختر خياراً». والخيار غير المتوفّر يُعرض معطّلاً لا مخفيّاً: المشتري الذي
 * لا يرى مقاسه يظنّ أن المتجر لا يبيعه أصلاً، لا أنه نفد.
 */
export function VariantPicker({ variants }: { variants: Variant[] }) {
  const [selected, setSelected] = useState<string>(variants[0]?.id ?? '');

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

  return (
    <div className="stack">
      <p className="product__price">
        <span className="money num">{current.price.formatted}</span>
        {discounted && current.compareAtPrice ? (
          <s className="muted num small">{current.compareAtPrice.formatted}</s>
        ) : null}
      </p>

      {axes.map(([attributeId, axis]) => (
        <fieldset key={attributeId} className="options">
          <legend className="field__label">
            {axis.nameAr}: <span className="muted">{axis.values.get(chosen.get(attributeId) ?? '')?.valueAr}</span>
          </legend>
          <div className="row">
            {[...axis.values.entries()].map(([valueId, value]) => {
              const reachable = variants.some(
                (v) =>
                  v.available > 0 &&
                  v.options.some((o) => o.attributeId === attributeId && o.valueId === valueId),
              );
              return (
                <button
                  key={valueId}
                  type="button"
                  className="option"
                  aria-pressed={chosen.get(attributeId) === valueId}
                  data-unavailable={!reachable}
                  onClick={() => pick(attributeId, valueId)}
                  title={reachable ? value.valueAr : `${value.valueAr} — نفد`}
                >
                  {value.hexColor ? (
                    <span className="option__swatch" style={{ background: value.hexColor }} aria-hidden />
                  ) : null}
                  {value.valueAr}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <p className="small" role="status">
        {current.available > 0 ? (
          current.available <= 3 ? (
            <span className="badge badge--warning">بقي {current.available} فقط</span>
          ) : (
            <span className="badge badge--approved">متوفّر</span>
          )
        ) : (
          <span className="badge badge--pending">هذا الخيار نفد</span>
        )}
      </p>

      <AddToCart variantId={current.id} disabled={current.available <= 0} />
    </div>
  );
}

function AddToCart({ variantId, disabled }: { variantId: string; disabled: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'added' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function add(): Promise<void> {
    setState('busy');
    setMessage(null);
    try {
      await cartApi.add(variantId, 1);
      setState('added');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'تعذّرت الإضافة إلى السلة.');
    }
  }

  return (
    <div className="stack stack--tight">
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={disabled || state === 'busy'}
        onClick={() => void add()}
      >
        {disabled ? 'نفد' : state === 'busy' ? 'جارٍ الإضافة…' : 'أضف إلى السلة'}
      </button>
      {state === 'added' ? (
        <p className="small" role="status">
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
