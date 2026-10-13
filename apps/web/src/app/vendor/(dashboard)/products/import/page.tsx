'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, apiBase, ApiError, session } from '@/lib/api';
import { Icon } from '@/components/icons';
import { num } from '@/lib/catalog';
import { csvCell } from '@/lib/csv';

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

/** دليل الأعمدة — بأسماء رؤوس القالب كما يقرؤها الخادم (import-plan) */
const COLUMN_GUIDE: readonly { col: string; desc: string }[] = [
  {
    col: 'رمز_المنتج',
    desc: 'يجمع متغيّرات المنتج الواحد: أسطر بالرمز نفسه تصير منتجاً واحداً بعدّة متغيّرات.',
  },
  { col: 'SKU', desc: 'رمز المتغيّر. SKU موجود يُحدَّث سعره وكميته، والجديد يُنشأ مسوّدة.' },
  { col: 'الفئة', desc: 'بالاسم أو بالرابط (المعرّف النصّي) — مثال fashion.' },
  { col: 'الخيار_1 · قيمة_الخيار_1', desc: 'الخيارات بأسمائها العربية — مثال «اللون» و«أحمر».' },
  { col: 'السعر · الكمية', desc: 'أرقام. الكمية إلزامية — اكتب 0 إن لم يتوفّر مخزون.' },
];

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
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);

  async function upload(chosen: File): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);
    setColumnFilter('');
    setFile({ name: chosen.name, size: chosen.size });
    try {
      setReport(await api<ImportReport>('/vendor/catalog/import', { method: 'POST', file: chosen }));
    } catch (err) {
      // رفض الملف كله (عمود مجهول مثلاً) يأتي برسالة واحدة تقول ما العمل
      setError(err instanceof ApiError ? err.message : 'تعذّر استيراد الملف.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate(): Promise<void> {
    const token = session.read()?.accessToken;
    const res = await fetch(`${apiBase()}/vendor/catalog/import/template`, {
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
      // السبب والرمز قد يحملان نصّ الملف نفسه — لا يُفتح معادلةً
      .map((cells) => cells.map(csvCell).join(','))
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

  function reset(): void {
    setError(null);
    setFile(null);
  }

  const columns = report
    ? [...new Set(report.rejected.flatMap((r) => r.reasons.map((x) => x.column ?? '—')))]
    : [];

  const columnCount = (c: string): number =>
    report ? report.rejected.filter((r) => r.reasons.some((x) => (x.column ?? '—') === c)).length : 0;

  const visible = report
    ? report.rejected.filter(
        (r) => !columnFilter || r.reasons.some((x) => (x.column ?? '—') === columnFilter),
      )
    : [];

  const state = busy ? 'running' : error ? 'rejected' : report ? 'done' : 'idle';

  return (
    <div className="vp-page vp-import">
      <div className="page-head">
        <Link className="btn btn--secondary btn--sm vp-back" href="/vendor/products">
          <Icon name="back" size={14} mirror />
          المنتجات
        </Link>
        <h1>الاستيراد الجماعي</h1>
      </div>

      <ol className="vp-steps">
        <li className="card vp-step">
          <span className="vp-step__head">
            <span className="vp-step__n num" aria-hidden>
              1
            </span>
            نزّل القالب
          </span>
          <span className="vp-step__body">ملف CSV عربي بأعمدته الجاهزة. استخدم رؤوسه كما هي.</span>
          <button type="button" className="btn btn--secondary btn--sm vp-step__btn" onClick={() => void downloadTemplate()}>
            <Icon name="download" size={14} />
            نزّل القالب
          </button>
        </li>
        <li className="card vp-step">
          <span className="vp-step__head">
            <span className="vp-step__n num" aria-hidden>
              2
            </span>
            املأه
          </span>
          <span className="vp-step__body">
            سطر لكل متغيّر. رمز المنتج يجمع متغيّرات المنتج الواحد، والخيارات بأسمائها العربية.
          </span>
        </li>
        <li className="card vp-step">
          <span className="vp-step__head">
            <span className="vp-step__n num" aria-hidden data-state={state === 'done' ? 'done' : undefined}>
              3
            </span>
            ارفعه
          </span>
          <span className="vp-step__body">CSV أو Excel، حتى 5 ميغابايت و5000 سطر.</span>
        </li>
      </ol>

      <section className="card vp-upload" data-state={state}>
        {state === 'idle' ? (
          <button
            type="button"
            className="vp-drop"
            data-dragging={dragging}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) void upload(dropped);
            }}
          >
            <Icon name="upload" size={30} className="vp-drop__icon" />
            <span className="vp-drop__title">اسحب ملفك إلى هنا أو اختر ملفاً</span>
            <span className="vp-drop__hint">CSV أو XLSX · حتى 5 ميغابايت · 5000 سطر كحد أقصى</span>
          </button>
        ) : null}

        {state === 'running' ? (
          <div className="vp-run" role="status">
            <span className="vp-run__file">
              <span className="tile-icon" aria-hidden>
                <Icon name="file" size={18} />
              </span>
              <span className="vp-run__text">
                <span className="num">{file?.name}</span>
                {file ? (
                  <span className="num vp-faint">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                ) : null}
              </span>
            </span>
            <span className="vp-run__bar" aria-hidden>
              <span />
            </span>
            <span className="row small muted">
              <span className="spinner" aria-hidden />
              جارٍ الاستيراد…
            </span>
          </div>
        ) : null}

        {state === 'rejected' ? (
          <div className="stack">
            <div className="vp-banner vp-banner--danger" role="alert">
              <span className="vp-banner__icon" aria-hidden>
                <Icon name="alert" size={18} />
              </span>
              <div className="vp-banner__text">
                <p className="vp-banner__title">رُفض الملف كاملاً — لم يُكتب أي سطر</p>
                <p>{error}</p>
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => void downloadTemplate()}>
                <Icon name="download" size={16} />
                نزّل القالب
              </button>
              <button type="button" className="btn btn--secondary" onClick={reset}>
                جرّب ملفاً آخر
              </button>
            </div>
          </div>
        ) : null}

        {state === 'done' && report ? (
          <div
            className={`vp-banner ${report.rejectedCount === 0 ? 'vp-banner--success' : 'vp-banner--warning'}`}
            role="status"
          >
            <span className="vp-banner__icon" aria-hidden>
              <Icon name={report.rejectedCount === 0 ? 'check' : 'alert'} size={18} />
            </span>
            <div className="vp-banner__text">
              <p className="vp-banner__title">اكتمل الاستيراد</p>
              <p>
                استُورد <span className="num">{num(report.imported)}</span> من{' '}
                <span className="num">{num(report.totalRows)}</span> سطراً ·{' '}
                <span className="num">{num(report.rejectedCount)}</span> مرفوضاً.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--sm vp-banner__action"
              onClick={() => input.current?.click()}
            >
              <Icon name="upload" size={14} />
              ارفع ملفاً آخر
            </button>
          </div>
        ) : null}

        <input
          ref={input}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void upload(chosen);
            e.target.value = '';
          }}
        />
      </section>

      {report ? (
        <section className="vp-report" aria-labelledby="vp-report-title">
          <div className="vp-report__head">
            <h2 id="vp-report-title">تقرير الاستيراد</h2>
            <span className="num vp-faint">{report.importId}</span>
          </div>

          <div className="stats">
            <div className="stat vp-stat--ok">
              <span className="stat__label">أسطر مستوردة</span>
              <span className="stat__value num">{num(report.imported)}</span>
              <span className="stat__note">
                من <span className="num">{num(report.totalRows)}</span> سطر في الملف
              </span>
            </div>
            <div className="stat vp-stat--bad">
              <span className="stat__label">أسطر مرفوضة</span>
              <span className="stat__value num">{num(report.rejectedCount)}</span>
              <span className="stat__note">لم تُكتب — صحّحها وأعد الرفع</span>
            </div>
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

          <div className="row">
            {report.rejectedCount > 0 ? (
              <button type="button" className="btn btn--primary" onClick={downloadRejected}>
                <Icon name="download" size={16} />
                نزّل الأسطر المرفوضة للتصحيح
              </button>
            ) : null}
            <Link className="btn btn--secondary" href="/vendor/products?status=draft">
              <Icon name="package" size={16} />
              راجع المنتجات المستوردة
            </Link>
          </div>

          {report.rejectedCount > 0 ? (
            <section className="card card--flush">
              <div className="card__head">
                <h2>الأسطر المرفوضة</h2>
                {columns.length > 1 ? (
                  <div className="tabs vp-filter" role="group" aria-label="تصفية بالعمود">
                    <button
                      type="button"
                      className="tabs__tab"
                      aria-pressed={columnFilter === ''}
                      onClick={() => setColumnFilter('')}
                    >
                      الكل
                      <span className="tabs__count">{num(report.rejected.length)}</span>
                    </button>
                    {columns.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="tabs__tab"
                        aria-pressed={columnFilter === c}
                        onClick={() => setColumnFilter(c)}
                      >
                        {c}
                        <span className="tabs__count">{num(columnCount(c))}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

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
                          <td>
                            سطر <span className="num">{num(r.line)}</span>
                          </td>
                          <td className="num" data-label="SKU">
                            {r.sku ?? '—'}
                          </td>
                          <td data-label="العمود">
                            <span className="badge badge--pending">{reason.column ?? '—'}</span>
                          </td>
                          <td className="wrap" data-label="السبب">
                            {reason.message}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      <section className="card card--flush">
        <div className="card__head">
          <h2>دليل الأعمدة</h2>
        </div>
        <dl className="vp-guide">
          {COLUMN_GUIDE.map((c) => (
            <div key={c.col} className="vp-guide__row">
              <dt className="vp-guide__col">{c.col}</dt>
              <dd>{c.desc}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
