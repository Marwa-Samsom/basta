'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { Alert, Field, Spinner, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/icons';
import { MAX_IMAGES, ProductImages } from '@/components/product-images';
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

/** حدّ الوصف كما يفرضه الخادم (MaxLength في DTO المنتج) */
const DESCRIPTION_MAX = 5000;

/** قائمة الخيارات تصير حبوباً ما دامت قصيرة؛ الطويلة تبقى قائمة منسدلة */
const PILL_LIMIT = 12;

const KIND: Record<EffectiveAttribute['inputType'], string> = {
  select: 'LIST',
  text: 'TEXT',
  number: 'NUMBER',
  boolean: 'BOOL',
};

/**
 * VD-08 — محرّر المنتج.
 *
 * ثلاث قواعد تحكم الشاشة:
 * 1. **تغيير الفئة يغيّر السمات**، فالسمات تُقرأ من الخادم لا تُخمَّن.
 * 2. **السعر والمخزون على المتغيّر** لا على المنتج (ADR-006) — حتى المنتج
 *    البسيط له متغيّر واحد، فالشكل واحد ولا فرعان في الكود.
 * 3. **«أرسل للمراجعة» يعرض الموانع مجتمعة** كما ترسلها الخدمة، ولا يخمّنها.
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
  const categoryName = categories.find((c) => c.id === form.categoryId)?.nameAr ?? null;
  const canPublish = product && product.status !== 'active' && product.status !== 'pending_review';

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

  /**
   * بعد عملية على الصور: المنتج يُقرأ من جديد — الصور وحالته (إضافة صورة لمنشور تعيده
   * للمراجعة). الحقول لا تُمسّ: ما كتبه البائع ولم يحفظه يبقى كما هو.
   */
  async function refreshProduct(): Promise<void> {
    if (!product) return;
    const fresh = await api<ProductDetail>(`/vendor/products/${product.id}`);
    setProduct(fresh);
    setBlockers([]);
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

  // ------------------------------------------------------------ الملخّص

  const prices = variants
    .map((v) => v.price.trim())
    .filter((p) => p !== '' && Number.isFinite(Number(p)))
    .sort((a, b) => Number(a) - Number(b));
  const priceRange =
    prices.length === 0
      ? null
      : prices[0] === prices[prices.length - 1]
        ? prices[0]
        : `${prices[0]} – ${prices[prices.length - 1]}`;
  const totalStock = variants.reduce((sum, v) => sum + Number(v.stock || 0), 0);
  const descLength = form.descriptionAr.length;

  return (
    <div className="vp-page">
      <div className="page-head">
        <Link className="btn btn--secondary btn--sm vp-back" href="/vendor/products">
          <Icon name="back" size={14} mirror />
          المنتجات
        </Link>
        <h1 className="vp-editor__title">{isNew ? 'منتج جديد' : form.nameAr || 'تحرير المنتج'}</h1>
        {product ? (
          <span className={`badge ${PRODUCT_STATUS[product.status].tone}`}>
            {PRODUCT_STATUS[product.status].label}
          </span>
        ) : null}
        <span className="page-head__actions">
          {product?.status === 'active' ? (
            <Link className="btn btn--secondary" href={`/p/${product.slug}`}>
              <Icon name="eye" size={16} />
              عاين
            </Link>
          ) : null}
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? 'جارٍ الحفظ…' : !product || product.status === 'draft' ? 'احفظ كمسودة' : 'احفظ'}
          </button>
          {canPublish ? (
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void publish()}>
              <Icon name="send" size={16} />
              أرسل للمراجعة
            </button>
          ) : null}
        </span>
      </div>

      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {product?.status === 'rejected' && product.rejectReason ? (
        <div className="vp-banner vp-banner--danger">
          <span className="vp-banner__icon" aria-hidden>
            <Icon name="alert" size={17} />
          </span>
          <div className="vp-banner__text">
            <p className="vp-banner__title">رُفض المنتج — سبب الإدارة</p>
            <p>{product.rejectReason}</p>
          </div>
        </div>
      ) : null}

      {product?.status === 'pending_review' ? (
        <div className="vp-banner vp-banner--warning">
          <Icon name="clock" size={18} className="vp-banner__glyph" />
          <p>
            <strong>قيد المراجعة</strong> — تراجع الإدارة منتجك قبل أن يظهر في المتجر.
          </p>
        </div>
      ) : null}

      {product?.status === 'active' ? (
        <div className="vp-banner vp-banner--info">
          <Icon name="info" size={16} className="vp-banner__glyph" />
          <p>
            تعديل المحتوى (الاسم، الوصف، الفئة، السمات، الصور أو الصورة الرئيسية) يعيد المنتج إلى المراجعة. السعر
            والمخزون لا يعيدانه.
          </p>
        </div>
      ) : null}

      <div className="vp-editor">
        <div className="vp-editor__main">
          <Section n={1} title="الأساسيات">
            <div className="vp-grid-2">
              <TextInput
                label="الاسم بالعربية *"
                required
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
              <TextInput
                label="الاسم بالإنجليزية"
                optional
                dir="ltr"
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              />
            </div>
            <div className="vp-grid-2">
              <Field label="الفئة *" hint="تغيير الفئة يغيّر السمات المطلوبة في القسم 4.">
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
            </div>
          </Section>

          <Section
            n={2}
            title="الوصف"
            meta={
              <span className="vp-sec__count num" data-over={descLength > DESCRIPTION_MAX}>
                {num(descLength)} / {num(DESCRIPTION_MAX)}
              </span>
            }
          >
            <TextArea
              label="الوصف بالعربية"
              optional
              rows={5}
              placeholder="اكتب وصفاً عربياً — المادة، المقاسات، العناية، ومن أين تشحن."
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
          </Section>

          <Section
            n={3}
            title="الصور"
            meta={
              <>
                <span className="vp-sec__count num">
                  {num(product?.images.length ?? 0)} / {num(MAX_IMAGES)}
                </span>
                <span className="vp-sec__meta">JPEG أو PNG أو WebP · حتى 10 م.ب · أقصر ضلع 300 بكسل</span>
              </>
            }
          >
            <ProductImages
              productId={product?.id ?? null}
              images={product?.images ?? []}
              onChanged={refreshProduct}
            />
          </Section>

          {plain.length > 0 ? (
            <Section
              n={4}
              title="سمات الفئة"
              meta={
                <span className="vp-sec__meta">
                  {categoryName ? `من «${categoryName}» — ` : ''}الحقول بعلامة{' '}
                  <span className="vp-req">*</span> إلزامية للنشر
                </span>
              }
            >
              <div className="vp-grid-2">
                {plain.map((attr) => (
                  <AttrField
                    key={attr.attributeId}
                    attr={attr}
                    value={attrValues[attr.attributeId] ?? ''}
                    onChange={(value) => setAttrValues({ ...attrValues, [attr.attributeId]: value })}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          <Section
            n={plain.length > 0 ? 5 : 4}
            title="المتغيّرات"
            meta={
              <span className="vp-sec__count num">
                {num(variants.length)} صفّ · حتى 3 محاور
              </span>
            }
          >
            <p className="card__hint">
              السعر والمخزون على المتغيّر. المنتج البسيط متغيّر واحد بلا خيارات.
            </p>

            {axes.length > 0 ? (
              <div className="vp-axes">
                <span className="vp-axes__label">المحاور المميّزة</span>
                {axes.map((a) => (
                  <span key={a.attributeId} className="vp-axis">
                    {a.nameAr}
                    <span className="num">{num(a.values.length)}</span>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="table-wrap vp-matrix-wrap">
              <table className="table vp-matrix">
                <thead>
                  <tr>
                    {axes.map((a) => (
                      <th key={a.attributeId} scope="col">
                        {a.nameAr}
                      </th>
                    ))}
                    <th scope="col">SKU</th>
                    <th scope="col">السعر{product ? ` · ${product.currency}` : ''}</th>
                    <th scope="col">الكمية</th>
                    <th scope="col">حدّ التنبيه</th>
                    <th scope="col">
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => (
                    <tr key={v.id ?? `new-${i}`}>
                      {axes.map((a) => (
                        <td key={a.attributeId} data-label={a.nameAr}>
                          <select
                            className="field__control vp-cell"
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
                      <td data-label="SKU">
                        <input
                          className="field__control num vp-cell vp-cell--sku"
                          dir="ltr"
                          aria-label={`SKU للمتغيّر ${num(i + 1)}`}
                          value={v.sku}
                          onChange={(e) => update(i, { sku: e.target.value.toUpperCase() })}
                        />
                      </td>
                      <td data-label="السعر">
                        <input
                          className="field__control money num vp-cell vp-cell--price"
                          dir="ltr"
                          inputMode="decimal"
                          aria-label={`السعر للمتغيّر ${num(i + 1)}`}
                          value={v.price}
                          onChange={(e) => update(i, { price: e.target.value })}
                        />
                      </td>
                      <td data-label="الكمية">
                        <input
                          className="field__control num vp-cell vp-cell--qty"
                          dir="ltr"
                          inputMode="numeric"
                          aria-label={`الكمية للمتغيّر ${num(i + 1)}`}
                          value={v.stock}
                          onChange={(e) => update(i, { stock: e.target.value.replace(/\D/g, '') })}
                        />
                      </td>
                      <td data-label="حدّ التنبيه">
                        <input
                          className="field__control num vp-cell vp-cell--qty"
                          dir="ltr"
                          inputMode="numeric"
                          aria-label={`حدّ التنبيه للمتغيّر ${num(i + 1)}`}
                          value={v.lowStockThreshold}
                          onChange={(e) =>
                            update(i, { lowStockThreshold: e.target.value.replace(/\D/g, '') })
                          }
                        />
                      </td>
                      <td data-label="" className="end">
                        {variants.length > 1 ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                          >
                            <Icon name="trash" size={14} />
                            حذف
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setVariants([...variants, emptyVariant()])}
              >
                <Icon name="plus" size={14} />
                أضف متغيّراً
              </button>
              <span className="vp-faint">بلا محاور يصبح المنتج صفاً واحداً.</span>
            </div>
            {product ? (
              <p className="small muted">
                السعر بعملة متجرك (<span className="num">{product.currency}</span>). المحجوز للمشترين في
                الدفع لا يُحسب متاحاً.
              </p>
            ) : null}
          </Section>
        </div>

        <aside className="vp-editor__side" aria-label="حالة الإرسال والملخّص">
          {blockers.length > 0 ? (
            <section className="vp-blockers" role="alert">
              <header className="vp-blockers__head">
                <Icon name="alert" size={17} />
                <h2>لا يمكن الإرسال: {obstacles(blockers.length)}</h2>
              </header>
              <ul className="vp-blockers__list">
                {blockers.map((message, i) => (
                  <li key={`r${i}`}>
                    <span className="vp-alert-dot" aria-hidden>
                      <Icon name="alert" size={12} />
                    </span>
                    {message}
                  </li>
                ))}
              </ul>
              <p className="vp-blockers__hint">كل العوائق تُعرض معاً — أصلحها كلها ثم أعد الإرسال.</p>
            </section>
          ) : null}

          <section className="card vp-summary">
            <h2 className="eyebrow">الملخّص</h2>
            <dl className="vp-summary__rows">
              {product ? (
                <div>
                  <dt>الحالة</dt>
                  <dd>{PRODUCT_STATUS[product.status].label}</dd>
                </div>
              ) : null}
              <div>
                <dt>الفئة</dt>
                <dd>{categoryName ?? '—'}</dd>
              </div>
              <div>
                <dt>المتغيّرات</dt>
                <dd className="num">{num(variants.length)}</dd>
              </div>
              <div>
                <dt>نطاق السعر</dt>
                <dd>
                  {priceRange ? (
                    <span className="money num">
                      {priceRange}
                      {product ? ` ${product.currency}` : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>المخزون الكلي</dt>
                <dd className="num">{num(totalStock)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );

  function update(index: number, patch: Partial<VariantDraft>): void {
    setVariants(variants.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }
}

/** قسم مرقّم من أقسام المحرّر — «1 · الأساسيات» */
function Section({
  n,
  title,
  meta,
  children,
}: {
  n: number;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="card vp-sec" aria-labelledby={id}>
      <header className="vp-sec__head">
        <h2 id={id}>
          <span className="num">{n}</span> · {title}
        </h2>
        {meta}
      </header>
      {children}
    </section>
  );
}

/**
 * سمة فئة واحدة. القائمة القصيرة حبوب تُضغط، والنعم/لا مفتاح مقسّم —
 * والضغط على المختار يلغيه، فتبقى السمة الاختيارية قابلة للتفريغ.
 */
function AttrField({
  attr,
  value,
  onChange,
}: {
  attr: EffectiveAttribute;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const label = (
    <>
      {attr.nameAr}
      {attr.isRequired ? <span className="vp-req"> *</span> : null}
    </>
  );
  const pills = attr.inputType === 'select' && attr.values.length <= PILL_LIMIT;
  const grouped = pills || attr.inputType === 'boolean';

  return (
    <div className="field vp-attr">
      <div className="vp-attr__head">
        {grouped ? (
          <span className="field__label" id={labelId}>
            {label}
          </span>
        ) : (
          <label className="field__label" htmlFor={id}>
            {label}
          </label>
        )}
        <span className="vp-attr__kind">{KIND[attr.inputType]}</span>
      </div>

      {pills ? (
        <div className="vp-pills" role="group" aria-labelledby={labelId}>
          {attr.values.map((v) => (
            <button
              key={v.id}
              type="button"
              className="vp-pill"
              aria-pressed={value === v.id}
              onClick={() => onChange(value === v.id ? '' : v.id)}
            >
              {v.valueAr}
            </button>
          ))}
        </div>
      ) : attr.inputType === 'boolean' ? (
        <div className="seg vp-seg" role="group" aria-labelledby={labelId}>
          {(
            [
              ['true', 'نعم'],
              ['false', 'لا'],
            ] as const
          ).map(([v, text]) => (
            <button
              key={v}
              type="button"
              className="seg__opt"
              aria-pressed={value === v}
              onClick={() => onChange(value === v ? '' : v)}
            >
              {text}
            </button>
          ))}
        </div>
      ) : attr.inputType === 'select' ? (
        <select
          id={id}
          className="field__control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {attr.values.map((v) => (
            <option key={v.id} value={v.id}>
              {v.valueAr}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={attr.inputType === 'number' ? 'field__control num' : 'field__control'}
          {...(attr.inputType === 'number' ? { dir: 'ltr' } : {})}
          inputMode={attr.inputType === 'number' ? 'numeric' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** «عائق واحد · عائقان · 3 عوائق · 11 عائقاً» — التمييز يتغيّر بالعدد */
function obstacles(n: number): string {
  if (n === 1) return 'عائق واحد';
  if (n === 2) return 'عائقان';
  if (n <= 10) return `${num(n)} عوائق`;
  return `${num(n)} عائقاً`;
}

/** خانات العملة — الدينار ثلاث والريال اثنتان (ADR-001) */
function decimalsOf(currency: string): number {
  return ['JOD', 'KWD', 'BHD', 'OMR', 'TND'].includes(currency) ? 3 : 2;
}

/**
 * مربّع الصورة المصغّرة لمنتج في قوائم البائع — الصورة الحقيقية إن وُجدت،
 * وإلا أيقونة: لا صورة بديلة تتظاهر بأنها صورة المنتج.
 */
export function ProductThumb({ src, size = 'md' }: { src: string | null; size?: 'sm' | 'md' }) {
  const url = mediaUrl(src);
  return (
    <span className={`vp-thumb vp-thumb--${size}`} aria-hidden>
      {url ? (
        // مصغّرة من خادم الرفع مباشرةً؛ next/image يحتاج إعداد مضيف بعيد لا يلزم محلياً
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" />
      ) : (
        <Icon name="image" size={size === 'sm' ? 15 : 17} />
      )}
    </span>
  );
}
