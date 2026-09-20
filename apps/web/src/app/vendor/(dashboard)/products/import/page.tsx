'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, API_BASE, ApiError, session } from '@/lib/api';
import { Alert, Card } from '@/components/ui';
import { num } from '@/lib/catalog';

interface RejectedLine {
  line: number;
  sku: string | null;
  reasons: { column: string | null; message: string }[];
}

interface ImportReport {
  importId: string;
  format: 'csv' | 'xlsx';
  totalRows: number;
  imported: number;
  productsCreated: number;
  variantsCreated: number;
  variantsUpdated: number;
  rejectedCount: number;
  rejected: RejectedLine[];
}

/**
 * VD-09 و VD-10 — الاستيراد الجماعي وتقريره في شاشة واحدة.
 *
 * فصلهما إلى شاشتين يجعل البائع يفقد التقرير بأول تنقّل. والتقرير هنا
 * **لا يرفض الملف كله**: الأسطر الصالحة تُكتب والخاطئة تُبلَّغ برقم سطرها
 * وعمودها وسببها، وتُنزَّل وحدها ليصلحها ويعيد رفعها.
 */
export default function ImportPage() {
  const input = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [columnFilter, setColumnFilter] = useState('');

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await api<ImportReport>('/vendor/catalog/import', { method: 'POST', file }));
    } catch (err) {
      // رفض الملف كله (عمود مجهول مثلاً) يأتي برسالة واحدة تقول ما العمل
      setError(err instanceof ApiError ? err.message : 'تعذّر استيراد الملف.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate(): Promise<void> {
    const token = session.read()?.accessToken;
    const res = await fetch(`${API_BASE}/vendor/catalog/import/template`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'basta-products-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadRejected(): void {
    if (!report) return;
    const rows = [
      ['السطر', 'SKU', 'العمود', 'السبب'],
      ...report.rejected.flatMap((r) =>
        r.reasons.map((reason) => [
          String(r.line),
          r.sku ?? '',
          reason.column ?? '',
          reason.message,
        ]),
      ),
    ];
    const csv = rows
      .map((cells) => cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\r\n');
    // BOM كي يفتح Excel العربية بلا تشويه
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rejected-${report.importId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = report
    ? [...new Set(report.rejected.flatMap((r) => r.reasons.map((x) => x.column ?? '—')))]
    : [];

  const visible = report
    ? report.rejected.filter(
        (r) => !columnFilter || r.reasons.some((x) => (x.column ?? '—') === columnFilter),
      )
    : [];

  return (
    <>
      <header className="row row--between">
        <h1>الاستيراد الجماعي</h1>
        <button type="button" className="btn btn--secondary" onClick={() => void downloadTemplate()}>
          نزّل القالب
        </button>
      </header>

      <Card title="كيف يعمل" hint="CSV أو Excel، حتى 5 ميغابايت و5000 سطر.">
        <ul className="blockers">
          <li className="blockers__item">
            <span aria-hidden>•</span>
            <span>رمز المنتج يجمع متغيّراته: أسطر بالرمز نفسه تصير منتجاً واحداً بعدّة متغيّرات.</span>
          </li>
          <li className="blockers__item">
            <span aria-hidden>•</span>
            <span>SKU موجود يُحدَّث سعره وكميته، والجديد يُنشأ مسوّدة.</span>
          </li>
          <li className="blockers__item">
            <span aria-hidden>•</span>
            <span>الفئة بالاسم أو بالرابط، والخيارات بأسمائها العربية.</span>
          </li>
        </ul>
      </Card>

      <div
        className="dropzone"
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
      >
        <p className="small">اسحب ملفك إلى هنا أو اختره من جهازك.</p>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'جارٍ الاستيراد…' : 'اختر ملفاً'}
        </button>
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>

      {error ? (
        <Alert tone="danger" title="لم يُكتب شيء من الملف">
          {error}
        </Alert>
      ) : null}

      {report ? (
        <>
          <Alert tone={report.rejectedCount === 0 ? 'success' : 'warning'} title="تقرير الاستيراد">
            استُورد <span className="num">{num(report.imported)}</span> من{' '}
            <span className="num">{num(report.totalRows)}</span> سطراً ·{' '}
            <span className="num">{num(report.rejectedCount)}</span> مرفوضاً.
          </Alert>

          <div className="stats">
            <div className="stat">
              <span className="stat__label">منتجات أُنشئت</span>
              <span className="stat__value num">{num(report.productsCreated)}</span>
              <span className="stat__note">كمسوّدات — تُرسل للنشر بعد مراجعتك</span>
            </div>
            <div className="stat">
              <span className="stat__label">متغيّرات أُنشئت</span>
              <span className="stat__value num">{num(report.variantsCreated)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">متغيّرات حُدّثت</span>
              <span className="stat__value num">{num(report.variantsUpdated)}</span>
              <span className="stat__note">السعر والكمية على SKU موجود</span>
            </div>
          </div>

          {report.rejectedCount > 0 ? (
            <Card
              title="الأسطر المرفوضة"
              aside={
                <button type="button" className="btn btn--secondary btn--sm" onClick={downloadRejected}>
                  نزّلها لتصحيحها
                </button>
              }
            >
              {columns.length > 1 ? (
                <div className="row">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    aria-pressed={columnFilter === ''}
                    onClick={() => setColumnFilter('')}
                  >
                    الكل
                  </button>
                  {columns.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="btn btn--secondary btn--sm"
                      aria-pressed={columnFilter === c}
                      onClick={() => setColumnFilter(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">السطر</th>
                      <th scope="col">SKU</th>
                      <th scope="col">العمود</th>
                      <th scope="col">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) =>
                      r.reasons.map((reason, i) => (
                        <tr key={`${r.line}-${i}`}>
                          <td className="num">{num(r.line)}</td>
                          <td className="num">{r.sku ?? '—'}</td>
                          <td>{reason.column ?? '—'}</td>
                          <td className="wrap">{reason.message}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <div className="row">
            <Link className="btn btn--primary" href="/vendor/products?status=draft">
              راجع المنتجات المستوردة
            </Link>
          </div>
        </>
      ) : null}
    </>
  );
}
