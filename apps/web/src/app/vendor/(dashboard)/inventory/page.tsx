'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { digitsOnly } from '@/lib/digits';
import { Alert, ClearableInput, EmptyState, Field, MoreButton, PageHead, Spinner, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ProductThumb } from '@/components/product-editor';
import { useAdminList } from '@/lib/admin';
import { num } from '@/lib/catalog';
import { counted, VARIANTS, type Counted } from '@/lib/arabic-count';
import { useLocale, useT } from '@/components/locale';

interface Row {
  productId: string;
  productNameAr: string;
  thumbnail: string | null;
  variantId: string;
  /** قيم خيارات المتغيّر — «أحمر · M»، وفارغ للمنتج البسيط */
  variant: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  /** علامة المخزون نفسها التي يُنبَّه بها البائع — الموجود بلغ حدّ التنبيه */
  isLow: boolean;
}

type Filter = 'all' | 'low' | 'out';

const isOut = (r: Row): boolean => r.available <= 0;

/** التصفية في الخادم — «المنخفض» بعلامة التنبيه، و«النافد» ما لا متاح منه */
const FILTERS: readonly { key: Filter; label: string; en: string }[] = [
  { key: 'all', label: 'الكل', en: 'All' },
  { key: 'low', label: 'المنخفض فقط', en: 'Low only' },
  { key: 'out', label: 'النافد', en: 'Out of stock' },
];

const REASONS = [
  ['manual_adjust', 'تعديل يدوي', 'Manual adjustment'],
  ['damage', 'تلف', 'Damage'],
  ['return', 'مرتجع', 'Return'],
] as const;

/** «واحد يحتاج انتباهاً»، «اثنان يحتاجان…»، «3 منها تحتاج…» — كان «4 متغيّراً · 3 يحتاج انتباهاً» (VCAT-086) */
const ATTENTION: Counted = {
  one: 'واحد يحتاج انتباهاً',
  two: 'اثنان يحتاجان انتباهاً',
  plural: '# منها تحتاج انتباهاً',
  accusative: '# منها يحتاج انتباهاً',
  genitive: '# منها يحتاج انتباهاً',
};

/**
 * VD-11 — المخزون.
 *
 * ثلاثة أعمدة لا عمود واحد: **الموجود** و**المحجوز** و**المتاح**. البائع الذي
 * يرى رقماً واحداً يظنّ أن قطعةً اختفت، وهي محجوزة لمشترٍ في الدفع (ADR-006).
 * وتعديل الكمية إلى ما دون المحجوز مرفوض — والتحذير يظهر قبل الحفظ لا بعده.
 */
export default function InventoryPage() {
  const t = useT();
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);

  // المخزون من الخادم متغيّراً متغيّراً، خمسين خمسين — البحث والتصفية هناك لا هنا، فما بعد
  // الصفحة الأولى يُوجد. كانت الصفحة أول مئة منتج ثم طلباً لكل منتج (20 أكتوبر 2026).
  const query = new URLSearchParams({ ...(filter !== 'all' ? { filter } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
  const list = useAdminList<Row, { counts: Record<Filter | 'attention', number> }>(`/vendor/inventory?${query}`, (r) => r.variantId);
  const { data, error } = list;
  const counts = data?.counts;
  const term = search.trim();

  return (
    <div className="vp-page">
      <PageHead
        title={t('المخزون', 'Inventory')}
        count={
          counts
            ? counts.all === 0
              ? t('لا متغيّرات بعد', 'No variants yet')
              : t(
                  `${counted(counts.all, VARIANTS)} · ${counts.attention === 0 ? 'لا شيء يحتاج انتباهاً' : counted(counts.attention, ATTENTION)}`,
                  `${num(counts.all, locale)} ${counts.all === 1 ? 'variant' : 'variants'} · ${num(counts.attention, locale)} ${counts.attention === 1 ? 'needs' : 'need'} attention`,
                )
            : undefined
        }
        actions={
          counts && counts.all > 0 ? (
            <span className="input-icon vp-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                className="field__control"
                aria-label={t('بحث في المخزون باسم المنتج أو SKU', 'Search inventory by product name or SKU')}
                placeholder={t('ابحث بالمنتج أو الرمز', 'Search by product or SKU')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
          ) : undefined
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? <Spinner label={t('جارٍ تحميل المخزون…', 'Loading inventory…')} /> : null}

      {counts && counts.all === 0 ? (
        <EmptyState
          icon="boxes"
          title={t('لا مخزون بعد', 'No stock yet')}
          actions={
            <Link className="btn btn--primary" href="/vendor/products/new">
              <Icon name="plus" size={16} />
              {t('أضف منتجاً', 'Add product')}
            </Link>
          }
        >
          {t('أضف منتجاً بمتغيّراته ليظهر مخزونه هنا.', 'Add a product with its variants to see its stock here.')}
        </EmptyState>
      ) : null}

      {data && counts && counts.all > 0 ? (
        <section className="card card--flush">
          <div className="card__head vp-toolbar">
            <div className="tabs vp-filter" role="group" aria-label={t('تصفية المخزون', 'Filter inventory')}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="tabs__tab"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {t(f.label, f.en)}
                  <span className="tabs__count">{num(counts[f.key], locale)}</span>
                </button>
              ))}
            </div>
            <span className="vp-toolbar__note">
              <Icon name="info" size={13} />
              {t('المتاح = الموجود − المحجوز', 'Available = On hand − Reserved')}
            </span>
          </div>

          {list.items.length === 0 ? (
            <div className="vp-nomatch">
              <span className="empty__icon vp-nomatch__icon" aria-hidden>
                <Icon name="boxes" size={24} />
              </span>
              <p className="vp-nomatch__title">
                {term
                  ? t(`لا نتائج تطابق «${term}»`, `No results match “${term}”`)
                  : filter === 'low'
                    ? t('لا متغيّر تحت حدّ التنبيه — مخزونك بخير.', 'No variant is below the alert level — your stock is fine.')
                    : t('لا متغيّر نافد — مخزونك بخير.', 'No variant is out of stock — your stock is fine.')}
              </p>
              <p className="small muted">{t('جرّب تصفية أخرى أو ابحث برمز مختلف.', 'Try another filter or search for a different SKU.')}</p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setFilter('all');
                  setSearch('');
                }}
              >
                {t('أزل التصفية', 'Clear filters')}
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table vp-inv">
                <thead>
                  <tr>
                    <th scope="col">{t('المنتج', 'Product')}</th>
                    <th scope="col">{t('المتغيّر', 'Variant')}</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="end">{t('الموجود', 'On hand')}</th>
                    <th scope="col" className="end">{t('المحجوز', 'Reserved')}</th>
                    <th scope="col" className="end">{t('المتاح', 'Available')}</th>
                    <th scope="col" className="end">{t('حدّ التنبيه', 'Alert level')}</th>
                    <th scope="col" className="end">
                      <span className="visually-hidden">{t('إجراءات', 'Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => {
                    const out = isOut(r);
                    const low = !out && r.isLow;
                    return (
                      <tr key={r.variantId} data-out={out || undefined}>
                        <td className="wrap">
                          <span className="vp-prod">
                            <ProductThumb src={r.thumbnail} size="sm" />
                            <span className="vp-prod__text">
                              <Link className="vp-prod__name" href={`/vendor/products/${r.productId}`}>
                                {r.productNameAr}
                              </Link>
                              {out ? (
                                <span className="badge badge--danger">{t('نفد', 'Out of stock')}</span>
                              ) : low ? (
                                <span className="badge badge--warning">{t('منخفض', 'Low')}</span>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td data-label={t('المتغيّر', 'Variant')}>{r.variant || '—'}</td>
                        <td className="num" data-label="SKU">
                          {r.sku}
                        </td>
                        <td className="end num vp-strong" data-label={t('الموجود', 'On hand')}>
                          {num(r.onHand, locale)}
                        </td>
                        <td className="end num" data-label={t('المحجوز', 'Reserved')}>
                          {r.reserved > 0 ? num(r.reserved, locale) : '—'}
                        </td>
                        <td className="end" data-label={t('المتاح', 'Available')}>
                          <span className="num vp-avail" data-tone={out ? 'out' : low ? 'low' : 'ok'}>
                            {num(r.available, locale)}
                          </span>
                        </td>
                        <td className="end num" data-label={t('حدّ التنبيه', 'Alert level')}>
                          {r.lowStockThreshold > 0 ? num(r.lowStockThreshold, locale) : '—'}
                        </td>
                        <td className="end" data-label="">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            aria-label={t(`عدّل مخزون ${r.sku}`, `Edit stock for ${r.sku}`)}
                            onClick={() => setEditing(r)}
                          >
                            {t('عدّل', 'Edit')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <MoreButton list={list} />
        </section>
      ) : null}

      {editing ? (
        <AdjustDialog
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<'count' | 'event'>('count');
  const [value, setValue] = useState(String(row.onHand));
  const [reason, setReason] = useState<'manual_adjust' | 'damage' | 'return'>('manual_adjust');
  const [note, setNote] = useState('');
  const [threshold, setThreshold] = useState(
    row.lowStockThreshold > 0 ? String(row.lowStockThreshold) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // نافذة حقيقية: التركيز يُحبس فيها، و Esc يغلقها، والصفحة خلفها خاملة
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  const target = mode === 'count' ? Number(value || 0) : row.onHand + Number(value || 0);
  const belowReserved = target < row.reserved;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      /**
       * `setTo` جرد فعلي و`delta` حدث — الخادم يرفض إرسالهما معاً، والسبب
       * إلزامي لأن حركة المخزون تُقيَّد في دفتر لا يُعدَّل (ADR-005): حركة
       * بلا سبب تصير سطراً لا يُفسَّر بعد شهر.
       */
      await api(`/vendor/products/${row.productId}/variants/${row.variantId}/stock`, {
        method: 'PATCH',
        body: {
          ...(mode === 'count' ? { setTo: Number(value || 0) } : { delta: Number(value || 0) }),
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(threshold ? { lowStockThreshold: Number(threshold) } : {}),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّر تعديل الكمية.', 'Could not update the quantity.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="vp-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // النقر على الخلفية (الحوار نفسه لا محتواه) يغلق
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="vp-dialog__panel">
        <header className="vp-dialog__head">
          <span className="vp-dialog__heading">
            <h2 id={titleId}>{t('عدّل المخزون', 'Edit stock')}</h2>
            <span className="vp-dialog__sub">
              {row.productNameAr}
              {row.variant ? ` — ${row.variant}` : ''} · <span className="num">{row.sku}</span>
            </span>
          </span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t('إغلاق', 'Close')} onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className="vp-dialog__body">
          <dl className="vp-adj-now">
            <div>
              <dt>{t('الموجود', 'On hand')}</dt>
              <dd className="num">{num(row.onHand, locale)}</dd>
            </div>
            <div>
              <dt>{t('المحجوز', 'Reserved')}</dt>
              <dd className="num vp-adj-now__reserved">{num(row.reserved, locale)}</dd>
            </div>
            <div>
              <dt>{t('المتاح', 'Available')}</dt>
              <dd className="num">{num(row.available, locale)}</dd>
            </div>
          </dl>

          <div className="field">
            <span className="field__label">{t('طريقة التعديل', 'Adjustment method')}</span>
            <div className="seg vp-seg vp-seg--block" role="group" aria-label={t('طريقة التعديل', 'Adjustment method')}>
              <button
                type="button"
                className="seg__opt"
                aria-pressed={mode === 'count'}
                onClick={() => {
                  setMode('count');
                  setValue(String(row.onHand));
                }}
              >
                {t('جرد: الكمية الموجودة الآن', 'Count: the quantity on hand now')}
              </button>
              <button
                type="button"
                className="seg__opt"
                aria-pressed={mode === 'event'}
                onClick={() => {
                  setMode('event');
                  setValue('0');
                }}
              >
                {t('حركة: زيادة أو نقص', 'Movement: increase or decrease')}
              </button>
            </div>
          </div>

          <Field
            label={mode === 'count' ? t('الكمية الموجودة', 'Quantity on hand') : t('التغيير (+ أو −)', 'Change (+ or −)')}
            hint={
              mode === 'count'
                ? t('نستبدل الرقم الحالي بما تُدخله — استخدمها بعد الجرد.', 'We replace the current number with what you enter — use this after a stock count.')
                : t('رقم موجب للإضافة، وسالب (بإشارة −) للنقص.', 'A positive number to add, a negative one (with −) to subtract.')
            }
            error={
              belowReserved
                ? t(
                    'الكمية أقل من المحجوز لمشترين في الدفع — حرّر الحجز أو ارفع الكمية.',
                    'The quantity is below what is reserved for buyers at checkout — release the reservation or raise the quantity.',
                  )
                : null
            }
          >
            {(props) => (
              <ClearableInput
                className="field__control num"
                dir="ltr"
                inputMode={mode === 'count' ? 'numeric' : 'text'}
                {...props}
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ''))}
              />
            )}
          </Field>

          <div className="field">
            <span className="field__label" id={`${titleId}-reason`}>
              {t('السبب', 'Reason')}
            </span>
            <div className="vp-pills" role="group" aria-labelledby={`${titleId}-reason`}>
              {REASONS.map(([key, text, en]) => (
                <button
                  key={key}
                  type="button"
                  className="vp-pill"
                  aria-pressed={reason === key}
                  onClick={() => setReason(key)}
                >
                  {t(text, en)}
                </button>
              ))}
            </div>
            <p className="field__hint">{t('يُقيَّد مع الحركة في سجل لا يُعدَّل.', 'Recorded with the movement in a log that cannot be edited.')}</p>
          </div>

          <TextArea
            label={t('ملاحظة', 'Note')}
            optional
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <TextInput
            label={t('حدّ التنبيه', 'Alert level')}
            optional
            dir="ltr"
            inputMode="numeric"
            hint={t('يظهر «منخفض» حين ينزل الموجود إلى هذا الحد — كالتنبيه وقائمة المنتجات.', '“Low” shows when stock on hand drops to this level — like the alert and the product list.')}
            value={threshold}
            onChange={(e) => setThreshold(digitsOnly(e.target.value))}
          />

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <dl className="vp-adj-after" data-invalid={belowReserved || undefined}>
            <div>
              <dt>{t('الموجود بعد التعديل', 'On hand after the change')}</dt>
              <dd className="num">{num(Math.max(target, 0), locale)}</dd>
            </div>
            <div>
              <dt>{t('المتاح', 'Available')}</dt>
              <dd className="num">{num(Math.max(target - row.reserved, 0), locale)}</dd>
            </div>
          </dl>
        </div>

        <footer className="vp-dialog__foot">
          <button className="btn btn--secondary" type="button" onClick={onClose}>
            {t('إلغاء', 'Cancel')}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy || belowReserved}
            onClick={() => void submit()}
          >
            {busy ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ التعديل', 'Save change')}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
