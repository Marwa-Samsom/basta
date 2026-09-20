'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Card, Field, Spinner, TextInput } from '@/components/ui';
import { num, type LowStockRow, type Page, type ProductListItem } from '@/lib/catalog';

interface Row {
  productId: string;
  productNameAr: string;
  variantId: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
}

/**
 * VD-11 — المخزون.
 *
 * ثلاثة أعمدة لا عمود واحد: **الموجود** و**المحجوز** و**المتاح**. البائع الذي
 * يرى رقماً واحداً يظنّ أن قطعةً اختفت، وهي محجوزة لمشترٍ في الدفع (ADR-006).
 * وتعديل الكمية إلى ما دون المحجوز مرفوض — والتحذير يظهر قبل الحفظ لا بعده.
 */
export default function InventoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
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
        page.items.map((p) => api<{ id: string; nameAr: string; variants: Row[] }>(
          `/vendor/products/${p.id}`,
        ).catch(() => null)),
      );

      const flat: Row[] = [];
      for (const detail of details) {
        if (!detail) continue;
        for (const v of detail.variants as unknown as {
          id: string;
          sku: string;
          stock: { onHand: number; reserved: number; available: number; lowStockThreshold: number };
        }[]) {
          flat.push({
            productId: detail.id,
            productNameAr: detail.nameAr,
            variantId: v.id,
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

  const visible = (rows ?? []).filter((r) => {
    if (lowOnly && !(r.lowStockThreshold > 0 && r.available <= r.lowStockThreshold)) return false;
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return r.sku.toLowerCase().includes(term) || r.productNameAr.includes(term);
  });

  return (
    <>
      <header className="row row--between">
        <h1>المخزون</h1>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!rows ? <Spinner label="جارٍ تحميل المخزون…" /> : null}

      {rows ? (
        <>
          <div className="row">
            <label className="row small">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />
              المنخفض فقط
            </label>
            <span className="grow">
              <TextInput
                label="بحث"
                hint="باسم المنتج أو SKU."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <p>{lowOnly ? 'لا متغيّر تحت حدّ التنبيه — مخزونك بخير.' : 'لا متغيّرات بعد.'}</p>
              <Link className="btn btn--secondary" href="/vendor/products/new">
                أضف منتجاً
              </Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">المنتج</th>
                    <th scope="col">SKU</th>
                    <th scope="col">الموجود</th>
                    <th scope="col">المحجوز</th>
                    <th scope="col">المتاح</th>
                    <th scope="col">حدّ التنبيه</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const low = r.lowStockThreshold > 0 && r.available <= r.lowStockThreshold;
                    return (
                      <tr key={r.variantId}>
                        <td className="wrap">
                          <Link href={`/vendor/products/${r.productId}`}>{r.productNameAr}</Link>
                        </td>
                        <td className="num" data-label="SKU">{r.sku}</td>
                        <td className="num" data-label="الموجود">{num(r.onHand)}</td>
                        <td className="num" data-label="المحجوز">{r.reserved > 0 ? num(r.reserved) : '—'}</td>
                        <td className="num" data-label="المتاح">
                          {num(r.available)}
                          {low ? <span className="badge badge--warning badge--after">منخفض</span> : null}
                        </td>
                        <td className="num" data-label="حدّ التنبيه">
                          {r.lowStockThreshold > 0 ? num(r.lowStockThreshold) : '—'}
                        </td>
                        <td data-label="">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setEditing(r)}
                          >
                            تعديل الكمية
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
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
    </>
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
  const [mode, setMode] = useState<'count' | 'event'>('count');
  const [value, setValue] = useState(String(row.onHand));
  const [reason, setReason] = useState<'manual_adjust' | 'damage' | 'return'>('manual_adjust');
  const [note, setNote] = useState('');
  const [threshold, setThreshold] = useState(
    row.lowStockThreshold > 0 ? String(row.lowStockThreshold) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Card title={`تعديل كمية ${row.sku}`} hint={`الموجود الآن ${num(row.onHand)} · المحجوز ${num(row.reserved)}`}>
      <div className="row">
        <button
          type="button"
          className="choice"
          aria-pressed={mode === 'count'}
          onClick={() => {
            setMode('count');
            setValue(String(row.onHand));
          }}
        >
          <span className="grow">
            <span className="choice__title">جرد</span>
            <span className="small muted"> — الكمية الموجودة الآن</span>
          </span>
        </button>
        <button
          type="button"
          className="choice"
          aria-pressed={mode === 'event'}
          onClick={() => {
            setMode('event');
            setValue('0');
          }}
        >
          <span className="grow">
            <span className="choice__title">حركة</span>
            <span className="small muted"> — زيادة أو نقص</span>
          </span>
        </button>
      </div>

      <Field
        label={mode === 'count' ? 'الكمية الموجودة' : 'التغيير (+ أو −)'}
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

      <Field label="السبب" hint="يُقيَّد مع الحركة في سجل لا يُعدَّل.">
        {(props) => (
          <select
            className="field__control"
            {...props}
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
          >
            <option value="manual_adjust">تعديل يدوي</option>
            <option value="damage">تلف</option>
            <option value="return">مرتجع</option>
          </select>
        )}
      </Field>

      <TextInput
        label="ملاحظة"
        optional
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
        onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <p className="small muted">
        بعد التعديل: الموجود {num(Math.max(target, 0))} · المتاح{' '}
        {num(Math.max(target - row.reserved, 0))}
      </p>

      <div className="row">
        <button
          className="btn btn--primary"
          type="button"
          disabled={busy || belowReserved}
          onClick={() => void submit()}
        >
          {busy ? 'جارٍ الحفظ…' : 'احفظ'}
        </button>
        <button className="btn btn--secondary" type="button" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Card>
  );
}
