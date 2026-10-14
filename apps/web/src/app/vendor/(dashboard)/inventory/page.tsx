'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { digitsOnly } from '@/lib/digits';
import { Alert, EmptyState, Field, PageHead, Spinner, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ProductThumb } from '@/components/product-editor';
import { num, type LowStockRow, type Page, type ProductListItem } from '@/lib/catalog';

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
}

type Filter = 'all' | 'low' | 'out';

const isLow = (r: Row): boolean => r.lowStockThreshold > 0 && r.available <= r.lowStockThreshold;
const isOut = (r: Row): boolean => r.available <= 0;

const FILTERS: readonly { key: Filter; label: string; test: (r: Row) => boolean }[] = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'low', label: 'المنخفض فقط', test: isLow },
  { key: 'out', label: 'النافد', test: isOut },
];

const REASONS = [
  ['manual_adjust', 'تعديل يدوي'],
  ['damage', 'تلف'],
  ['return', 'مرتجع'],
] as const;

/**
 * VD-11 — المخزون.
 *
 * ثلاثة أعمدة لا عمود واحد: **الموجود** و**المحجوز** و**المتاح**. البائع الذي
 * يرى رقماً واحداً يظنّ أن قطعةً اختفت، وهي محجوزة لمشترٍ في الدفع (ADR-006).
 * وتعديل الكمية إلى ما دون المحجوز مرفوض — والتحذير يظهر قبل الحفظ لا بعده.
 */
export default function InventoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  /** يجمع صفوف المخزون أو يعيد رسالة الخطأ — بلا ضبط حالة، فيصلح للتأثير وللتحديث معاً. */
  const collect = useCallback(async (): Promise<Row[] | string> => {
    try {
      // المخزون يُقرأ من المنتجات نفسها: لا مسار منفصل يعيد ما تعيده القائمة
      const [page, low] = await Promise.all([
        api<Page<ProductListItem>>('/vendor/products?pageSize=100'),
        api<LowStockRow[]>('/vendor/inventory/low-stock'),
      ]);

      const details = await Promise.all(
        page.items.map((p) =>
          api<{ id: string; nameAr: string; variants: unknown[] }>(`/vendor/products/${p.id}`)
            .then((d) => ({ detail: d, thumbnail: p.thumbnail }))
            .catch(() => null),
        ),
      );

      const flat: Row[] = [];
      for (const entry of details) {
        if (!entry) continue;
        const { detail, thumbnail } = entry;
        for (const v of detail.variants as {
          id: string;
          sku: string;
          options?: { valueAr: string }[];
          stock: { onHand: number; reserved: number; available: number; lowStockThreshold: number };
        }[]) {
          flat.push({
            productId: detail.id,
            productNameAr: detail.nameAr,
            thumbnail,
            variantId: v.id,
            variant: (v.options ?? []).map((o) => o.valueAr).join(' · '),
            sku: v.sku,
            onHand: v.stock.onHand,
            reserved: v.stock.reserved,
            available: v.stock.available,
            lowStockThreshold: v.stock.lowStockThreshold,
          });
        }
      }
      // ترتيب المنخفض أولاً: ما يحتاج تدخّلاً يُرى بلا بحث
      const lowIds = new Set(low.map((l) => l.variantId));
      flat.sort((a, b) => Number(lowIds.has(b.variantId)) - Number(lowIds.has(a.variantId)));
      return flat;
    } catch (err) {
      return err instanceof Error ? err.message : 'تعذّر تحميل المخزون.';
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await collect();
    if (typeof next === 'string') setError(next);
    else {
      setRows(next);
      setError(null);
    }
  }, [collect]);

  // أول تحميل داخل التأثير نفسه: لا ضبط حالة قبل انتهاء الطلب
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await collect();
      if (!alive) return;
      if (typeof next === 'string') setError(next);
      else setRows(next);
    })();
    return () => {
      alive = false;
    };
  }, [collect]);

  const all = rows ?? [];
  const active = FILTERS.find((f) => f.key === filter);
  const term = search.trim().toLowerCase();
  const visible = all.filter((r) => {
    if (active && !active.test(r)) return false;
    if (!term) return true;
    return r.sku.toLowerCase().includes(term) || r.productNameAr.includes(term);
  });
  const attention = all.filter((r) => isLow(r) || isOut(r)).length;

  return (
    <div className="vp-page">
      <PageHead
        title="المخزون"
        count={
          rows
            ? rows.length === 0
              ? 'لا متغيّرات بعد'
              : `${num(rows.length)} متغيّراً · ${num(attention)} يحتاج انتباهاً`
            : undefined
        }
        actions={
          rows && rows.length > 0 ? (
            <span className="input-icon vp-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                className="field__control"
                aria-label="بحث في المخزون باسم المنتج أو SKU"
                placeholder="ابحث بالمنتج أو الرمز"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
          ) : undefined
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!rows && !error ? <Spinner label="جارٍ تحميل المخزون…" /> : null}

      {rows && rows.length === 0 ? (
        <EmptyState
          icon="boxes"
          title="لا مخزون بعد"
          actions={
            <Link className="btn btn--primary" href="/vendor/products/new">
              <Icon name="plus" size={16} />
              أضف منتجاً
            </Link>
          }
        >
          أضف منتجاً بمتغيّراته ليظهر مخزونه هنا.
        </EmptyState>
      ) : null}

      {rows && rows.length > 0 ? (
        <section className="card card--flush">
          <div className="card__head vp-toolbar">
            <div className="tabs vp-filter" role="group" aria-label="تصفية المخزون">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="tabs__tab"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="tabs__count">{num(all.filter(f.test).length)}</span>
                </button>
              ))}
            </div>
            <span className="vp-toolbar__note">
              <Icon name="info" size={13} />
              المتاح = الموجود − المحجوز
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="vp-nomatch">
              <span className="empty__icon vp-nomatch__icon" aria-hidden>
                <Icon name="boxes" size={24} />
              </span>
              <p className="vp-nomatch__title">
                {term
                  ? `لا نتائج تطابق «${search.trim()}»`
                  : filter === 'low'
                    ? 'لا متغيّر تحت حدّ التنبيه — مخزونك بخير.'
                    : 'لا متغيّر نافد — مخزونك بخير.'}
              </p>
              <p className="small muted">جرّب تصفية أخرى أو ابحث برمز مختلف.</p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setFilter('all');
                  setSearch('');
                }}
              >
                أزل التصفية
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table vp-inv">
                <thead>
                  <tr>
                    <th scope="col">المنتج</th>
                    <th scope="col">المتغيّر</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="end">الموجود</th>
                    <th scope="col" className="end">المحجوز</th>
                    <th scope="col" className="end">المتاح</th>
                    <th scope="col" className="end">حدّ التنبيه</th>
                    <th scope="col" className="end">
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const out = isOut(r);
                    const low = !out && isLow(r);
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
                                <span className="badge badge--danger">نفد</span>
                              ) : low ? (
                                <span className="badge badge--warning">منخفض</span>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td data-label="المتغيّر">{r.variant || '—'}</td>
                        <td className="num" data-label="SKU">
                          {r.sku}
                        </td>
                        <td className="end num vp-strong" data-label="الموجود">
                          {num(r.onHand)}
                        </td>
                        <td className="end num" data-label="المحجوز">
                          {r.reserved > 0 ? num(r.reserved) : '—'}
                        </td>
                        <td className="end" data-label="المتاح">
                          <span className="num vp-avail" data-tone={out ? 'out' : low ? 'low' : 'ok'}>
                            {num(r.available)}
                          </span>
                        </td>
                        <td className="end num" data-label="حدّ التنبيه">
                          {r.lowStockThreshold > 0 ? num(r.lowStockThreshold) : '—'}
                        </td>
                        <td className="end" data-label="">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            aria-label={`عدّل مخزون ${r.sku}`}
                            onClick={() => setEditing(r)}
                          >
                            عدّل
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {editing ? (
        <AdjustDialog
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void refresh();
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
      setError(err instanceof Error ? err.message : 'تعذّر تعديل الكمية.');
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
            <h2 id={titleId}>عدّل المخزون</h2>
            <span className="vp-dialog__sub">
              {row.productNameAr}
              {row.variant ? ` — ${row.variant}` : ''} · <span className="num">{row.sku}</span>
            </span>
          </span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="إغلاق" onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className="vp-dialog__body">
          <dl className="vp-adj-now">
            <div>
              <dt>الموجود</dt>
              <dd className="num">{num(row.onHand)}</dd>
            </div>
            <div>
              <dt>المحجوز</dt>
              <dd className="num vp-adj-now__reserved">{num(row.reserved)}</dd>
            </div>
            <div>
              <dt>المتاح</dt>
              <dd className="num">{num(row.available)}</dd>
            </div>
          </dl>

          <div className="field">
            <span className="field__label">طريقة التعديل</span>
            <div className="seg vp-seg vp-seg--block" role="group" aria-label="طريقة التعديل">
              <button
                type="button"
                className="seg__opt"
                aria-pressed={mode === 'count'}
                onClick={() => {
                  setMode('count');
                  setValue(String(row.onHand));
                }}
              >
                جرد: الكمية الموجودة الآن
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
                حركة: زيادة أو نقص
              </button>
            </div>
          </div>

          <Field
            label={mode === 'count' ? 'الكمية الموجودة' : 'التغيير (+ أو −)'}
            hint={
              mode === 'count'
                ? 'نستبدل الرقم الحالي بما تُدخله — استخدمها بعد الجرد.'
                : 'رقم موجب للإضافة، وسالب (بإشارة −) للنقص.'
            }
            error={belowReserved ? 'الكمية أقل من المحجوز لمشترين في الدفع — حرّر الحجز أو ارفع الكمية.' : null}
          >
            {(props) => (
              <input
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
              السبب
            </span>
            <div className="vp-pills" role="group" aria-labelledby={`${titleId}-reason`}>
              {REASONS.map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  className="vp-pill"
                  aria-pressed={reason === key}
                  onClick={() => setReason(key)}
                >
                  {text}
                </button>
              ))}
            </div>
            <p className="field__hint">يُقيَّد مع الحركة في سجل لا يُعدَّل.</p>
          </div>

          <TextArea
            label="ملاحظة"
            optional
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <TextInput
            label="حدّ التنبيه"
            optional
            dir="ltr"
            inputMode="numeric"
            hint="يظهر «منخفض» حين ينزل المتاح إلى هذا الحد."
            value={threshold}
            onChange={(e) => setThreshold(digitsOnly(e.target.value))}
          />

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <dl className="vp-adj-after" data-invalid={belowReserved || undefined}>
            <div>
              <dt>الموجود بعد التعديل</dt>
              <dd className="num">{num(Math.max(target, 0))}</dd>
            </div>
            <div>
              <dt>المتاح</dt>
              <dd className="num">{num(Math.max(target - row.reserved, 0))}</dd>
            </div>
          </dl>
        </div>

        <footer className="vp-dialog__foot">
          <button className="btn btn--secondary" type="button" onClick={onClose}>
            إلغاء
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy || belowReserved}
            onClick={() => void submit()}
          >
            {busy ? 'جارٍ الحفظ…' : 'احفظ التعديل'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
