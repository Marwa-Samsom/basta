'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { digitsOnly } from '@/lib/digits';
import { Alert, ClearableInput, EmptyState, Field, Spinner, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/icons';
import { MAX_IMAGES, ProductImages } from '@/components/product-images';
import { useOnboarding } from '@/lib/vendor';
import { formatMoney } from '@/lib/money';
import {
  PRODUCT_STATUS,
  num,
  type Attribute,
  type ProductDetail,
  type VendorCategory,
} from '@/lib/catalog';

interface VariantDraft {
  id?: string;
  sku: string;
  price: string;
  stock: string;
  /**
   * الكمية كما قرأها المحرّر من الخادم — تُرسَل `stock` حين يغيّرها البائع وحدها.
   * الخادم يترجمها جرداً (setTo)، فكان كل حفظ لوصف أو سمة يعيد الرقم الذي فُتحت عليه
   * الصفحة: بيعٌ جرى أثناءها يرجع قطعاً وهمية تُباع ولا وجود لها (VCAT-018).
   */
  stockLoaded?: string;
  lowStockThreshold: string;
  /** السعر قبل الخصم — يظهر مشطوباً للمشتري إن كان أعلى من السعر؛ فارغ = بلا خصم */
  compareAtPrice: string;
  barcode: string;
  /** بالغرام — يدخل تسعير الشحن بالوزن */
  weightGrams: string;
  /** معرّف قيمة لكل محور — المفتاح معرّف السمة */
  options: Record<string, string>;
  isActive: boolean;
}

const emptyVariant = (): VariantDraft => ({
  sku: '',
  price: '',
  stock: '0',
  lowStockThreshold: '',
  compareAtPrice: '',
  barcode: '',
  weightGrams: '',
  options: {},
  isActive: true,
});

/** حدّ الوصف كما يفرضه الخادم (MaxLength في DTO المنتج) */
const DESCRIPTION_MAX = 5000;

/** قيمة الخيار الأخير في قائمة الفئات — يفتح حقل «فئة جديدة» ولا يُحفظ */
const NEW_CATEGORY = '__new__';

/** قائمة الخيارات تصير حبوباً ما دامت قصيرة؛ الطويلة تبقى قائمة منسدلة */
const PILL_LIMIT = 12;

const KIND: Record<Attribute['inputType'], string> = {
  select: 'LIST',
  text: 'TEXT',
  number: 'NUMBER',
  boolean: 'BOOL',
};

/**
 * VD-08 — محرّر المنتج.
 *
 * ثلاث قواعد تحكم الشاشة:
 * 1. **السمات مكتبة عامة** يختار البائع منها محاور متغيّراته (حتى ثلاثة)، والفئة من
 *    فئات متجره — يضيف الجديدة من القائمة نفسها بلا إدارة (14 أكتوبر 2026).
 * 2. **السعر والمخزون على المتغيّر** لا على المنتج (ADR-006) — حتى المنتج
 *    البسيط له متغيّر واحد، فالشكل واحد ولا فرعان في الكود.
 * 3. **«انشر» فوري بلا مراجعة** (15 أكتوبر 2026)، ويعرض الموانع مجتمعة كما ترسلها
 *    الخدمة ولا يخمّنها. متجر قيد المراجعة ينشر فيظهر منتجه لحظة اعتماده.
 */
export function ProductEditor({ productId }: { productId?: string }) {
  const router = useRouter();
  const isNew = !productId;

  const [loading, setLoading] = useState(true);
  /** تعذّر فتح المحرّر: لا نموذج يُرسم، بل الخطأ و«أعد المحاولة» — أو «غير موجود» لمنتج غائب أو لمتجر آخر */
  const [loadError, setLoadError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[]>([]);
  // حالة المتجر — المنشور قبل اعتماده يُقال له متى يظهر
  const { data: store } = useOnboarding();
  const storeInReview = store?.status === 'in_review';

  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  /** محاور المتغيّرات المختارة لهذا المنتج — بترتيب اختيارها */
  const [axisIds, setAxisIds] = useState<string[]>([]);
  /** null = الحقل مغلق؛ نصّ = البائع يكتب اسم فئة جديدة */
  const [newCat, setNewCat] = useState<string | null>(null);
  const [newCatError, setNewCatError] = useState<string | null>(null);
  const [newCatBusy, setNewCatBusy] = useState(false);
  const [product, setProduct] = useState<ProductDetail | null>(null);

  const [form, setForm] = useState({
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    vendorCategoryId: '',
  });
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);

  // ------------------------------------------------------------ التحميل

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [library, own, detail] = await Promise.all([
          api<Attribute[]>('/attributes', { auth: false }),
          api<VendorCategory[]>('/vendor/categories'),
          productId ? api<ProductDetail>(`/vendor/products/${productId}`) : Promise.resolve(null),
        ]);
        if (!alive) return;

        setAttributes(library);
        setCategories(own);
        if (detail) {
          setProduct(detail);
          setForm({
            nameAr: detail.nameAr,
            nameEn: detail.nameEn ?? '',
            descriptionAr: detail.descriptionAr ?? '',
            vendorCategoryId: detail.vendorCategory?.id ?? '',
          });
          setAxisIds(detail.variants[0]?.options.map((o) => o.attributeId) ?? []);
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
              stockLoaded: String(v.stock.onHand),
              lowStockThreshold: v.stock.lowStockThreshold ? String(v.stock.lowStockThreshold) : '',
              compareAtPrice: v.compareAtPrice
                ? (Number(v.compareAtPrice.minorUnits) / 10 ** decimalsOf(v.compareAtPrice.currency)).toString()
                : '',
              barcode: v.barcode ?? '',
              weightGrams: v.weightGrams !== null ? String(v.weightGrams) : '',
              options: Object.fromEntries(v.options.map((o) => [o.attributeId, o.valueId])),
              isActive: v.isActive,
            })),
          );
        }
      } catch (err) {
        if (alive) {
          setLoadError({
            message: err instanceof Error ? err.message : 'تعذّر تحميل المحرّر.',
            notFound: err instanceof ApiError && err.status === 404,
          });
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [productId, attempt]);

  if (loading) {
    return <Spinner label="جارٍ فتح المحرّر…" />;
  }

  // ما لم يُحمَّل لا يُرسم نموذجه: كان المحرّر يرسمه فارغاً تحت التنبيه و«احفظ» فعّال، فحفظٌ منه
  // بعد عودة الشبكة يكتب الفراغ فوق المنتج ويؤرشف متغيّراته الغائبة عنه (VCAT-019 و VCAT-100، 30 أكتوبر 2026)
  if (loadError) {
    return (
      <div className="vp-page">
        <div className="page-head">
          <Link className="btn btn--secondary btn--sm vp-back" href="/vendor/products">
            <Icon name="back" size={14} mirror />
            المنتجات
          </Link>
        </div>
        {loadError.notFound ? (
          <EmptyState
            title="المنتج غير موجود."
            actions={
              <Link className="btn btn--secondary" href="/vendor/products">
                العودة إلى المنتجات
              </Link>
            }
          >
            ربما الرابط قديم، أو لمنتج متجر آخر.
          </EmptyState>
        ) : (
          <div className="alert alert--danger" role="alert">
            <p>{loadError.message}</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setLoadError(null);
                setLoading(true);
                setAttempt((n) => n + 1);
              }}
            >
              <Icon name="refresh" size={15} />
              أعد المحاولة
            </button>
          </div>
        )}
      </div>
    );
  }

  const axisChoices = attributes.filter((a) => a.isVariantAxis && a.values.length > 0);
  const axes = axisIds.flatMap((id) => axisChoices.filter((a) => a.attributeId === id));
  const plain = attributes.filter((a) => !a.isVariantAxis);
  const categoryName = categories.find((c) => c.id === form.vendorCategoryId)?.nameAr ?? null;
  const canPublish = product && product.status !== 'active';

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
      ...(form.vendorCategoryId ? { vendorCategoryId: form.vendorCategoryId } : {}),
      attributes: attrs,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        sku: v.sku.trim(),
        price: v.price.trim(),
        // الجديد يحتاج كميته؛ القائم تُرسَل كميته إن غيّرها البائع وحدها — وإلا يبقى مخزونه كما هو
        ...(v.id === undefined || v.stock !== v.stockLoaded ? { stock: Number(v.stock || 0) } : {}),
        ...(v.lowStockThreshold ? { lowStockThreshold: Number(v.lowStockThreshold) } : {}),
        // خانات ظاهرة: الفارغة تمحو صراحةً (null)، والمكتوبة تُحفظ — ما يراه البائع هو ما يُحفظ
        compareAtPrice: v.compareAtPrice.trim() || null,
        barcode: v.barcode.trim() || null,
        weightGrams: v.weightGrams ? Number(v.weightGrams) : null,
        ...(axes.length > 0
          ? {
              options: axes.flatMap((a) => {
                const valueId = v.options[a.attributeId];
                return valueId ? [{ attributeId: a.attributeId, valueId }] : [];
              }),
            }
          : {}),
      })),
    };
  }

  /** محور يُضاف إلى المصفوفة أو يُرفع منها — والمرفوع تُمحى قيمه من كل الصفوف */
  function toggleAxis(id: string): void {
    if (axisIds.includes(id)) {
      setAxisIds(axisIds.filter((a) => a !== id));
      setVariants(
        variants.map((v) => ({ ...v, options: Object.fromEntries(Object.entries(v.options).filter(([k]) => k !== id)) })),
      );
    } else if (axisIds.length < 3) {
      setAxisIds([...axisIds, id]);
    }
  }

  /** فئة جديدة في متجر البائع من مكانها — تُضاف إلى القائمة وتُختار */
  async function addCategory(): Promise<void> {
    const name = (newCat ?? '').trim();
    if (!name) return;
    setNewCatBusy(true);
    setNewCatError(null);
    try {
      const created = await api<VendorCategory>('/vendor/categories', { method: 'POST', body: { nameAr: name } });
      setCategories([...categories, created]);
      setForm({ ...form, vendorCategoryId: created.id });
      setNewCat(null);
    } catch (err) {
      setNewCatError(err instanceof Error ? err.message : 'تعذّرت إضافة الفئة.');
    } finally {
      setNewCatBusy(false);
    }
  }

  /** ما يمنع الحفظ قبل إرساله — يُقال بالاسم بدل رفض الخادم العام، أو null */
  function unsavable(): string | null {
    // لا منتج بلا فئة (18 أكتوبر 2026) — والقديم بلا فئة يُصنَّف عند أوّل حفظ
    if (!form.vendorCategoryId) return 'اختر فئة للمنتج من «الفئة في متجرك»، أو أضف فئة جديدة.';
    // محور مختار بلا قيمة في صفّ
    const unset = axes.find((a) => variants.some((v) => !v.options[a.attributeId]));
    if (unset) return `اختر «${unset.nameAr}» لكل متغيّر، أو أزله من «ما يميّز متغيّراتك».`;
    return null;
  }

  /** يكتب ما في النموذج: منتج جديد بلا معرّف، أو تعديل المنتج ذي المعرّف */
  function write(id: string | null | undefined): Promise<ProductDetail> {
    return id
      ? api<ProductDetail>(`/vendor/products/${id}`, { method: 'PATCH', body: payload() })
      : api<ProductDetail>('/vendor/products', { method: 'POST', body: payload() });
  }

  /**
   * المنتج كما حفظه الخادم صار أساس المقارنة: كمية كل متغيّر قائم تُعرض كما في القاعدة
   * الآن، فحفظ تالٍ لا يعيد رقماً كتبه البائع قبل بيعٍ جرى بعده.
   */
  function settle(saved: ProductDetail): void {
    setProduct(saved);
    const onHand = new Map(saved.variants.map((v) => [v.id, String(v.stock.onHand)]));
    setVariants((rows) =>
      rows.map((v) => {
        const now = v.id ? onHand.get(v.id) : undefined;
        return now === undefined ? v : { ...v, stock: now, stockLoaded: now };
      }),
    );
  }

  async function save(): Promise<void> {
    const problem = unsavable();
    if (problem) {
      setNotice(null);
      setFailure(problem);
      return;
    }
    setBusy(true);
    setFailure(null);
    setNotice(null);
    setBlockers([]);
    try {
      const saved = await write(isNew ? null : productId);
      settle(saved);
      setNotice('حُفظ المنتج.');
      if (isNew) router.replace(`/vendor/products/${saved.id}`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'تعذّر حفظ المنتج.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * بعد عملية على الصور: المنتج يُقرأ من جديد بصوره. الحقول لا تُمسّ: ما كتبه البائع
   * ولم يحفظه يبقى كما هو.
   */
  async function refreshProduct(): Promise<void> {
    if (!product) return;
    const fresh = await api<ProductDetail>(`/vendor/products/${product.id}`);
    setProduct(fresh);
    setBlockers([]);
  }

  async function publish(): Promise<void> {
    if (!product) return;
    // يُنشر ما على الشاشة لا آخر حفظ: فئة اختيرت ولم تُحفظ كان النشر يُرفض بـ«اختر فئة»
    // وهي ظاهرة في الحقل والملخّص (J-05، 19 أكتوبر 2026). فالنشر يحفظ أولاً
    const problem = unsavable();
    if (problem) {
      setNotice(null);
      setFailure(problem);
      return;
    }
    setBusy(true);
    setFailure(null);
    setNotice(null);
    setBlockers([]);
    try {
      settle(await write(product.id));
      const next = await api<ProductDetail>(`/vendor/products/${product.id}/publish`, {
        method: 'POST',
      });
      setProduct(next);
      setNotice(storeInReview ? 'نُشر المنتج — يظهر للمشترين لحظة اعتماد متجرك.' : 'نُشر المنتج — يراه المشترون الآن.');
    } catch (err) {
      // الموانع تأتي من الخدمة مجتمعة — تُعرض كما هي لا تُختصر
      if (err instanceof ApiError && Array.isArray(err.details?.['reasons'])) {
        setBlockers(err.details['reasons'] as string[]);
      } else {
        setFailure(err instanceof Error ? err.message : 'تعذّر نشر المنتج.');
      }
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------ الملخّص

  const prices = variants
    .map((v) => v.price.trim())
    .filter((p) => p !== '' && Number.isFinite(Number(p)))
    .map(Number)
    .sort((a, b) => a - b);
  // بتنسيق المال كبقية الموقع «12.500 د.أ.» — كان النصّ كما كُتب في الخانة وبعده رمز العملة «12.5 JOD»،
  // والسعران «12.5» و«12.50» نطاقاً لأنهما نصّان (VON-055، 28 أكتوبر 2026)
  const priceCurrency = product?.currency ?? store?.settlementCurrency ?? null;
  const shown = (p: number): string =>
    priceCurrency ? formatMoney(BigInt(Math.round(p * 10 ** decimalsOf(priceCurrency))), priceCurrency) : String(p);
  const priceRange =
    prices.length === 0
      ? null
      : prices[0] === prices[prices.length - 1]
        ? shown(prices[0]!)
        : `${shown(prices[0]!)} – ${shown(prices[prices.length - 1]!)}`;
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
          {/* صفحة المنتج للمشتري: منتج متجر غير معتمد مخفي عنه فتُعطي 404 — «عاين» للمعتمد وحده */}
          {product?.status === 'active' && store?.status === 'approved' ? (
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
              انشر
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
            <p className="vp-banner__title">أوقفت الإدارة هذا المنتج — السبب</p>
            <p>{product.rejectReason}</p>
            <p>عدّله ثم اضغط «انشر» ليظهر للمشترين من جديد.</p>
          </div>
        </div>
      ) : null}

      {product?.status === 'active' ? (
        <div className="vp-banner vp-banner--info">
          <Icon name="info" size={16} className="vp-banner__glyph" />
          <p>
            {storeInReview
              ? 'منشور — يظهر للمشترين لحظة اعتماد متجرك، وتعديلاتك محفوظة معه.'
              : 'منشور ويراه المشترون — تعديلاتك تظهر لهم فور الحفظ.'}
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
              <Field
                label="الفئة في متجرك"
                hint="إلزامية — تظهر للمشترين أزراراً في صفحة متجرك. أدرها كلها من «الفئات» في القائمة."
              >
                {(props) => (
                  <select
                    className="field__control"
                    {...props}
                    value={form.vendorCategoryId}
                    onChange={(e) => {
                      if (e.target.value === NEW_CATEGORY) {
                        setNewCat('');
                        setNewCatError(null);
                      } else {
                        setForm({ ...form, vendorCategoryId: e.target.value });
                      }
                    }}
                  >
                    <option value="" disabled>
                      اختر فئة
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameAr}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY}>+ إضافة فئة جديدة…</option>
                  </select>
                )}
              </Field>
              {newCat !== null ? (
                <div className="field">
                  <label className="field__label" htmlFor="vp-new-category">
                    اسم الفئة الجديدة
                  </label>
                  <div className="vp-newcat">
                    <ClearableInput
                      id="vp-new-category"
                      className="field__control"
                      // يظهر الحقل بطلب البائع نفسه من القائمة — فالتركيز فيه متوقَّع لا مفاجئ
                      autoFocus
                      maxLength={80}
                      placeholder="مثل: قمصان صيفية"
                      value={newCat}
                      aria-invalid={Boolean(newCatError)}
                      aria-describedby={newCatError ? 'vp-new-category-error' : undefined}
                      onChange={(e) => setNewCat(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void addCategory();
                        } else if (e.key === 'Escape') {
                          setNewCat(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={newCatBusy || !newCat.trim()}
                      onClick={() => void addCategory()}
                    >
                      <Icon name="plus" size={14} />
                      أضف
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNewCat(null)}>
                      إلغاء
                    </button>
                  </div>
                  {newCatError ? (
                    <p className="field__error" id="vp-new-category-error" role="alert">
                      {newCatError}
                    </p>
                  ) : null}
                </div>
              ) : null}
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
              variants={product?.variants ?? []}
              onChanged={refreshProduct}
            />
          </Section>

          {plain.length > 0 ? (
            <Section
              n={4}
              title="المواصفات"
              meta={<span className="vp-sec__meta">اختيارية — تظهر للمشتري في صفحة المنتج</span>}
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

            {axisChoices.length > 0 ? (
              <div className="vp-axes" role="group" aria-label="محاور المتغيّرات">
                <span className="vp-axes__label">ما يميّز متغيّراتك</span>
                {axisChoices.map((a) => {
                  const on = axisIds.includes(a.attributeId);
                  return (
                    <button
                      key={a.attributeId}
                      type="button"
                      className="vp-axis"
                      aria-pressed={on}
                      disabled={!on && axisIds.length >= 3}
                      onClick={() => toggleAxis(a.attributeId)}
                    >
                      <Icon name={on ? 'check' : 'plus'} size={12} />
                      {a.nameAr}
                      <span className="num">{num(a.values.length)}</span>
                    </button>
                  );
                })}
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
                    <th scope="col">قبل الخصم</th>
                    <th scope="col">الكمية</th>
                    <th scope="col">حدّ التنبيه</th>
                    <th scope="col">الباركود</th>
                    <th scope="col">الوزن · غ</th>
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
                        <ClearableInput
                          className="field__control num vp-cell vp-cell--sku"
                          dir="ltr"
                          aria-label={`SKU للمتغيّر ${num(i + 1)}`}
                          value={v.sku}
                          onChange={(e) => update(i, { sku: e.target.value.toUpperCase() })}
                        />
                      </td>
                      <td data-label="السعر">
                        <ClearableInput
                          className="field__control money num vp-cell vp-cell--price"
                          dir="ltr"
                          inputMode="decimal"
                          aria-label={`السعر للمتغيّر ${num(i + 1)}`}
                          value={v.price}
                          onChange={(e) => update(i, { price: e.target.value })}
                        />
                      </td>
                      <td data-label="قبل الخصم">
                        <ClearableInput
                          className="field__control num vp-cell vp-cell--price"
                          dir="ltr"
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`السعر قبل الخصم للمتغيّر ${num(i + 1)}`}
                          value={v.compareAtPrice}
                          onChange={(e) => update(i, { compareAtPrice: e.target.value })}
                        />
                      </td>
                      <td data-label="الكمية">
                        <ClearableInput
                          className="field__control num vp-cell vp-cell--qty"
                          dir="ltr"
                          inputMode="numeric"
                          aria-label={`الكمية للمتغيّر ${num(i + 1)}`}
                          value={v.stock}
                          onChange={(e) => update(i, { stock: digitsOnly(e.target.value) })}
                        />
                      </td>
                      <td data-label="حدّ التنبيه">
                        <ClearableInput
                          className="field__control num vp-cell vp-cell--qty"
                          dir="ltr"
                          inputMode="numeric"
                          aria-label={`حدّ التنبيه للمتغيّر ${num(i + 1)}`}
                          value={v.lowStockThreshold}
                          onChange={(e) =>
                            update(i, { lowStockThreshold: digitsOnly(e.target.value) })
                          }
                        />
                      </td>
                      <td data-label="الباركود">
                        <ClearableInput
                          className="field__control num vp-cell vp-cell--sku"
                          dir="ltr"
                          maxLength={64}
                          placeholder="—"
                          aria-label={`الباركود للمتغيّر ${num(i + 1)}`}
                          value={v.barcode}
                          onChange={(e) => update(i, { barcode: e.target.value })}
                        />
                      </td>
                      <td data-label="الوزن · غ">
                        <ClearableInput
                          className="field__control num vp-cell vp-cell--qty"
                          dir="ltr"
                          inputMode="numeric"
                          placeholder="—"
                          aria-label={`الوزن بالغرام للمتغيّر ${num(i + 1)}`}
                          value={v.weightGrams}
                          onChange={(e) => update(i, { weightGrams: digitsOnly(e.target.value) })}
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

        <aside className="vp-editor__side" aria-label="حالة النشر والملخّص">
          {blockers.length > 0 ? (
            <section className="vp-blockers" role="alert">
              <header className="vp-blockers__head">
                <Icon name="alert" size={17} />
                <h2>لا يمكن النشر: {obstacles(blockers.length)}</h2>
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
              <p className="vp-blockers__hint">كل العوائق تُعرض معاً — أصلحها كلها ثم انشر.</p>
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
                <dd>{categoryName ?? 'لم تُختر — مطلوبة'}</dd>
              </div>
              <div>
                <dt>المتغيّرات</dt>
                <dd className="num">{num(variants.length)}</dd>
              </div>
              <div>
                <dt>نطاق السعر</dt>
                <dd>
                  {priceRange ? (
                    <span className="money num">{priceRange}</span>
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
 * سمة واحدة من المواصفات. القائمة القصيرة حبوب تُضغط، والنعم/لا مفتاح مقسّم —
 * والضغط على المختار يلغيه، فتبقى السمة الاختيارية قابلة للتفريغ.
 */
function AttrField({
  attr,
  value,
  onChange,
}: {
  attr: Attribute;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const label = attr.nameAr;
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
        <ClearableInput
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
