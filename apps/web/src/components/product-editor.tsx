'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, BlockerList, Card, Field, Spinner, TextArea, TextInput } from '@/components/ui';
import {
  PRODUCT_STATUS,
  num,
  type Category,
  type EffectiveAttribute,
  type ProductDetail,
} from '@/lib/catalog';

interface VariantDraft {
  id?: string;
  sku: string;
  price: string;
  stock: string;
  lowStockThreshold: string;
  /** معرّف قيمة لكل محور — المفتاح معرّف السمة */
  options: Record<string, string>;
  isActive: boolean;
}

const emptyVariant = (): VariantDraft => ({
  sku: '',
  price: '',
  stock: '0',
  lowStockThreshold: '',
  options: {},
  isActive: true,
});

/**
 * VD-08 — محرّر المنتج.
 *
 * ثلاث قواعد تحكم الشاشة:
 * 1. **تغيير الفئة يغيّر السمات**، فالسمات تُقرأ من الخادم لا تُخمَّن.
 * 2. **السعر والمخزون على المتغيّر** لا على المنتج (ADR-006) — حتى المنتج
 *    البسيط له متغيّر واحد، فالشكل واحد ولا فرعان في الكود.
 * 3. **«أرسل للنشر» يعرض الموانع مجتمعة** كما ترسلها الخدمة، ولا يخمّنها.
 */
export function ProductEditor({ productId }: { productId?: string }) {
  const router = useRouter();
  const isNew = !productId;

  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [attributes, setAttributes] = useState<EffectiveAttribute[]>([]);
  const [product, setProduct] = useState<ProductDetail | null>(null);

  const [form, setForm] = useState({
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    categoryId: '',
  });
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);

  // ------------------------------------------------------------ التحميل

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const tree = await api<Category[]>('/categories', { auth: false });
        const flat: Category[] = [];
        const walk = (nodes: Category[]): void => {
          for (const n of nodes) {
            flat.push(n);
            if (n.children?.length) walk(n.children);
          }
        };
        walk(tree);

        let detail: ProductDetail | null = null;
        if (productId) detail = await api<ProductDetail>(`/vendor/products/${productId}`);
        if (!alive) return;

        setCategories(flat);
        if (detail) {
          setProduct(detail);
          setForm({
            nameAr: detail.nameAr,
            nameEn: detail.nameEn ?? '',
            descriptionAr: detail.descriptionAr ?? '',
            categoryId: detail.category.id,
          });
          setAttrValues(
            Object.fromEntries(
              detail.attributes.map((a) => [a.attributeId, a.valueId ?? a.valueAr ?? a.number ?? '']),
            ),
          );
          setVariants(
            detail.variants.map((v) => ({
              id: v.id,
              sku: v.sku,
              price: (Number(v.price.minorUnits) / 10 ** decimalsOf(v.price.currency)).toString(),
              stock: String(v.stock.onHand),
              lowStockThreshold: v.stock.lowStockThreshold ? String(v.stock.lowStockThreshold) : '',
              options: Object.fromEntries(v.options.map((o) => [o.attributeId, o.valueId])),
              isActive: v.isActive,
            })),
          );
        }
      } catch (err) {
        if (alive) setFailure(err instanceof Error ? err.message : 'تعذّر تحميل المحرّر.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [productId]);

  // سمات الفئة تُقرأ من الخادم عند كل تغيير فئة — الوراثة من الأصول تُحسب هناك
  useEffect(() => {
    if (!form.categoryId) return;
    let alive = true;
    void (async () => {
      try {
        const list = await api<EffectiveAttribute[]>(
          `/categories/${form.categoryId}/attributes`,
          { auth: false },
        );
        if (alive) setAttributes(list);
      } catch {
        if (alive) setAttributes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [form.categoryId]);

  if (loading) {
    return <Spinner label="جارٍ فتح المحرّر…" />;
  }

  const axes = attributes.filter((a) => a.isVariantAxis && a.values.length > 0);
  const plain = attributes.filter((a) => !a.isVariantAxis);

  // ------------------------------------------------------------- الحفظ

  function payload(): Record<string, unknown> {
    const attrs = Object.entries(attrValues)
      .filter(([, v]) => v !== '' && v !== undefined)
      .map(([attributeId, value]) => {
        const attr = attributes.find((a) => a.attributeId === attributeId);
        if (attr?.inputType === 'select') return { attributeId, valueId: value };
        if (attr?.inputType === 'number') return { attributeId, number: Number(value) };
        if (attr?.inputType === 'boolean') return { attributeId, boolean: value === 'true' };
        return { attributeId, text: value };
      });

    return {
      nameAr: form.nameAr,
      ...(form.nameEn ? { nameEn: form.nameEn } : {}),
      ...(form.descriptionAr ? { descriptionAr: form.descriptionAr } : {}),
      categoryId: form.categoryId,
      attributes: attrs,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        sku: v.sku.trim(),
        price: v.price.trim(),
        stock: Number(v.stock || 0),
        ...(v.lowStockThreshold ? { lowStockThreshold: Number(v.lowStockThreshold) } : {}),
        ...(Object.keys(v.options).length > 0
          ? {
              options: Object.entries(v.options).map(([attributeId, valueId]) => ({
                attributeId,
                valueId,
              })),
            }
          : {}),
      })),
    };
  }

  async function save(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    setBlockers([]);
    try {
      const saved = isNew
        ? await api<ProductDetail>('/vendor/products', { method: 'POST', body: payload() })
        : await api<ProductDetail>(`/vendor/products/${productId}`, {
            method: 'PATCH',
            body: payload(),
          });
      setProduct(saved);
      setNotice('حُفظ المنتج.');
      if (isNew) router.replace(`/vendor/products/${saved.id}`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'تعذّر حفظ المنتج.');
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    if (!product) return;
    setBusy(true);
    setFailure(null);
    setBlockers([]);
    try {
      const next = await api<ProductDetail>(`/vendor/products/${product.id}/publish`, {
        method: 'POST',
      });
      setProduct(next);
      setNotice('أُرسل المنتج إلى مراجعة الإدارة.');
    } catch (err) {
      // الموانع تأتي من الخدمة مجتمعة — تُعرض كما هي لا تُختصر
      if (err instanceof ApiError && Array.isArray(err.details?.['reasons'])) {
        setBlockers(err.details['reasons'] as string[]);
      } else {
        setFailure(err instanceof Error ? err.message : 'تعذّر إرسال المنتج.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="row row--between">
        <h1>{isNew ? 'منتج جديد' : form.nameAr || 'تحرير المنتج'}</h1>
        {product ? (
          <span className={`badge ${PRODUCT_STATUS[product.status].tone}`}>
            {PRODUCT_STATUS[product.status].label}
          </span>
        ) : null}
      </header>

      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {product?.status === 'rejected' && product.rejectReason ? (
        <Alert tone="danger" title="سبب الرفض">
          {product.rejectReason}
        </Alert>
      ) : null}

      {blockers.length > 0 ? (
        <BlockerList
          blockers={blockers.map((message, i) => ({ code: `r${i}`, message, field: '' }))}
        />
      ) : null}

      <Card title="الأساسيات">
        <TextInput
          label="اسم المنتج بالعربية"
          required
          value={form.nameAr}
          onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
        />
        <TextInput
          label="اسم المنتج بالإنجليزية"
          optional
          dir="ltr"
          value={form.nameEn}
          onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
        />
        <Field label="الفئة" hint="تغيير الفئة يغيّر السمات المطلوبة.">
          {(props) => (
            <select
              className="field__control"
              {...props}
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">اختر فئة…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {'— '.repeat(Math.max(c.depth - 1, 0))}
                  {c.nameAr}
                </option>
              ))}
            </select>
          )}
        </Field>
        <TextArea
          label="الوصف"
          optional
          value={form.descriptionAr}
          onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
        />
      </Card>

      {plain.length > 0 ? (
        <Card title="سمات الفئة" hint="السمات المعلَّمة بنجمة إلزامية للنشر.">
          {plain.map((attr) => (
            <Field
              key={attr.attributeId}
              label={`${attr.nameAr}${attr.isRequired ? ' *' : ''}`}
              optional={!attr.isRequired}
            >
              {(props) =>
                attr.inputType === 'select' ? (
                  <select
                    className="field__control"
                    {...props}
                    value={attrValues[attr.attributeId] ?? ''}
                    onChange={(e) =>
                      setAttrValues({ ...attrValues, [attr.attributeId]: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {attr.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.valueAr}
                      </option>
                    ))}
                  </select>
                ) : attr.inputType === 'boolean' ? (
                  <select
                    className="field__control"
                    {...props}
                    value={attrValues[attr.attributeId] ?? ''}
                    onChange={(e) =>
                      setAttrValues({ ...attrValues, [attr.attributeId]: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    <option value="true">نعم</option>
                    <option value="false">لا</option>
                  </select>
                ) : (
                  <input
                    className="field__control"
                    {...props}
                    inputMode={attr.inputType === 'number' ? 'numeric' : 'text'}
                    value={attrValues[attr.attributeId] ?? ''}
                    onChange={(e) =>
                      setAttrValues({ ...attrValues, [attr.attributeId]: e.target.value })
                    }
                  />
                )
              }
            </Field>
          ))}
        </Card>
      ) : null}

      <Card
        title="المتغيّرات"
        hint="السعر والمخزون على المتغيّر. المنتج البسيط متغيّر واحد بلا خيارات."
        aside={
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setVariants([...variants, emptyVariant()])}
          >
            أضف متغيّراً
          </button>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {axes.map((a) => (
                  <th key={a.attributeId} scope="col">
                    {a.nameAr}
                  </th>
                ))}
                <th scope="col">SKU</th>
                <th scope="col">السعر</th>
                <th scope="col">الكمية</th>
                <th scope="col">حدّ التنبيه</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.id ?? `new-${i}`}>
                  {axes.map((a) => (
                    <td key={a.attributeId}>
                      <select
                        className="field__control"
                        aria-label={`${a.nameAr} للمتغيّر ${num(i + 1)}`}
                        value={v.options[a.attributeId] ?? ''}
                        onChange={(e) =>
                          update(i, { options: { ...v.options, [a.attributeId]: e.target.value } })
                        }
                      >
                        <option value="">—</option>
                        {a.values.map((val) => (
                          <option key={val.id} value={val.id}>
                            {val.valueAr}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td>
                    <input
                      className="field__control num"
                      dir="ltr"
                      aria-label={`SKU للمتغيّر ${num(i + 1)}`}
                      value={v.sku}
                      onChange={(e) => update(i, { sku: e.target.value.toUpperCase() })}
                    />
                  </td>
                  <td>
                    <input
                      className="field__control num"
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={`السعر للمتغيّر ${num(i + 1)}`}
                      value={v.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="field__control num"
                      dir="ltr"
                      inputMode="numeric"
                      aria-label={`الكمية للمتغيّر ${num(i + 1)}`}
                      value={v.stock}
                      onChange={(e) => update(i, { stock: e.target.value.replace(/\D/g, '') })}
                    />
                  </td>
                  <td>
                    <input
                      className="field__control num"
                      dir="ltr"
                      inputMode="numeric"
                      aria-label={`حدّ التنبيه للمتغيّر ${num(i + 1)}`}
                      value={v.lowStockThreshold}
                      onChange={(e) =>
                        update(i, { lowStockThreshold: e.target.value.replace(/\D/g, '') })
                      }
                    />
                  </td>
                  <td>
                    {variants.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                      >
                        حذف
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {product ? (
          <p className="small muted">
            السعر بعملة متجرك ({product.currency}). المحجوز للمشترين في الدفع لا يُحسب متاحاً.
          </p>
        ) : null}
      </Card>

      <div className="row row--between">
        <button className="btn btn--secondary" type="button" onClick={() => router.push('/vendor/products')}>
          رجوع للقائمة
        </button>
        <span className="row">
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
          {product && product.status !== 'active' && product.status !== 'pending_review' ? (
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void publish()}>
              أرسل للنشر
            </button>
          ) : null}
        </span>
      </div>
    </>
  );

  function update(index: number, patch: Partial<VariantDraft>): void {
    setVariants(variants.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }
}

/** خانات العملة — الدينار ثلاث والريال اثنتان (ADR-001) */
function decimalsOf(currency: string): number {
  return ['JOD', 'KWD', 'BHD', 'OMR', 'TND'].includes(currency) ? 3 : 2;
}
