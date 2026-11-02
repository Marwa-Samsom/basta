'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, apiBase, ApiError, session } from '@/lib/api';
import { Icon } from '@/components/icons';
import { num } from '@/lib/catalog';
import { useLocale, useT } from '@/components/locale';
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
const COLUMN_GUIDE: readonly { col: string; desc: string; en: string }[] = [
  {
    col: 'رمز_المنتج',
    desc: 'يجمع متغيّرات المنتج الواحد: أسطر بالرمز نفسه تصير منتجاً واحداً بعدّة متغيّرات.',
    en: 'Groups the variants of one product: rows with the same code become one product with several variants.',
  },
  {
    col: 'SKU',
    desc: 'رمز المتغيّر. SKU موجود يُحدَّث سعره وكميته، والجديد يُنشأ مسوّدة.',
    en: 'The variant code. An existing SKU gets its price and quantity updated; a new one is created as a draft.',
  },
  {
    col: 'الفئة',
    desc: 'إلزامية — اسم فئة من فئات متجرك (مثل «أزياء وملابس»)، وتُنشأ إن لم تكن موجودة.',
    en: "Required — the name of one of your shop categories (e.g. «أزياء وملابس»); it is created if it doesn't exist.",
  },
  {
    col: 'الخيار_1 · قيمة_الخيار_1',
    desc: 'الخيارات بأسمائها العربية — مثال «اللون» و«أحمر».',
    en: 'Options by their Arabic names — e.g. «اللون» and «أحمر».',
  },
  {
    col: 'السعر · الكمية',
    desc: 'أرقام. الكمية إلزامية — اكتب 0 إن لم يتوفّر مخزون.',
    en: 'Numbers. Quantity is required — enter 0 if out of stock.',
  },
];

/**
 * VD-09 و VD-10 — الاستيراد الجماعي وتقريره في شاشة واحدة.
 *
 * فصلهما إلى شاشتين يجعل البائع يفقد التقرير بأول تنقّل. والتقرير هنا
 * **لا يرفض الملف كله**: الأسطر الصالحة تُكتب والخاطئة تُبلَّغ برقم سطرها
 * وعمودها وسببها، وتُنزَّل وحدها ليصلحها ويعيد رفعها.
 */
export default function ImportPage() {
  const t = useT();
  const locale = useLocale();
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
      setError(err instanceof ApiError ? err.message : t('تعذّر استيراد الملف.', "Couldn't import the file."));
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
      [t('السطر', 'Line'), 'SKU', t('العمود', 'Column'), t('السبب', 'Reason')],
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
          {t('المنتجات', 'Products')}
        </Link>
        <h1>{t('الاستيراد الجماعي', 'Bulk import')}</h1>
      </div>

      <ol className="vp-steps">
        <li className="card vp-step">
          <span className="vp-step__head">
            <span className="vp-step__n num" aria-hidden>
              1
            </span>
            {t('نزّل القالب', 'Download the template')}
          </span>
          <span className="vp-step__body">
            {t('ملف CSV عربي بأعمدته الجاهزة. استخدم رؤوسه كما هي.', 'An Arabic CSV file with its columns ready. Keep its headers as they are.')}
          </span>
          <button type="button" className="btn btn--secondary btn--sm vp-step__btn" onClick={() => void downloadTemplate()}>
            <Icon name="download" size={14} />
            {t('نزّل القالب', 'Download the template')}
          </button>
        </li>
        <li className="card vp-step">
          <span className="vp-step__head">
            <span className="vp-step__n num" aria-hidden>
              2
            </span>
            {t('املأه', 'Fill it in')}
          </span>
          <span className="vp-step__body">
            {t(
              'سطر لكل متغيّر. رمز المنتج يجمع متغيّرات المنتج الواحد، والخيارات بأسمائها العربية.',
              'One row per variant. The product code groups the variants of one product, and options use their Arabic names.',
            )}
          </span>
        </li>
        <li className="card vp-step">
          <span className="vp-step__head">
            <span className="vp-step__n num" aria-hidden data-state={state === 'done' ? 'done' : undefined}>
              3
            </span>
            {t('ارفعه', 'Upload it')}
          </span>
          <span className="vp-step__body">{t('CSV أو Excel، حتى 5 ميغابايت و5000 سطر.', 'CSV or Excel, up to 5 MB and 5000 rows.')}</span>
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
            <span className="vp-drop__title">{t('اسحب ملفك إلى هنا أو اختر ملفاً', 'Drag your file here or choose a file')}</span>
            <span className="vp-drop__hint">
              {t('CSV أو XLSX · حتى 5 ميغابايت · 5000 سطر كحد أقصى', 'CSV or XLSX · up to 5 MB · 5000 rows max')}
            </span>
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
              {t('جارٍ الاستيراد…', 'Importing…')}
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
                <p className="vp-banner__title">
                  {t('رُفض الملف كاملاً — لم يُكتب أي سطر', 'The whole file was rejected — no rows were written')}
                </p>
                <p>{error}</p>
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => void downloadTemplate()}>
                <Icon name="download" size={16} />
                {t('نزّل القالب', 'Download the template')}
              </button>
              <button type="button" className="btn btn--secondary" onClick={reset}>
                {t('جرّب ملفاً آخر', 'Try another file')}
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
              <p className="vp-banner__title">{t('اكتمل الاستيراد', 'Import complete')}</p>
              <p>
                {t('استُورد', 'Imported')} <span className="num">{num(report.imported, locale)}</span> {t('من', 'of')}{' '}
                <span className="num">{num(report.totalRows, locale)}</span>{' '}
                {t('سطراً', report.totalRows === 1 ? 'row' : 'rows')} ·{' '}
                <span className="num">{num(report.rejectedCount, locale)}</span> {t('مرفوضاً', 'rejected')}.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--sm vp-banner__action"
              onClick={() => input.current?.click()}
            >
              <Icon name="upload" size={14} />
              {t('ارفع ملفاً آخر', 'Upload another file')}
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
            <h2 id="vp-report-title">{t('تقرير الاستيراد', 'Import report')}</h2>
            <span className="num vp-faint">{report.importId}</span>
          </div>

          <div className="stats">
            <div className="stat vp-stat--ok">
              <span className="stat__label">{t('أسطر مستوردة', 'Rows imported')}</span>
              <span className="stat__value num">{num(report.imported, locale)}</span>
              <span className="stat__note">
                {t('من', 'of')} <span className="num">{num(report.totalRows, locale)}</span>{' '}
                {t('سطر في الملف', report.totalRows === 1 ? 'row in the file' : 'rows in the file')}
              </span>
            </div>
            <div className="stat vp-stat--bad">
              <span className="stat__label">{t('أسطر مرفوضة', 'Rows rejected')}</span>
              <span className="stat__value num">{num(report.rejectedCount, locale)}</span>
              <span className="stat__note">{t('لم تُكتب — صحّحها وأعد الرفع', 'Not written — fix them and upload again')}</span>
            </div>
            <div className="stat">
              <span className="stat__label">{t('منتجات أُنشئت', 'Products created')}</span>
              <span className="stat__value num">{num(report.productsCreated, locale)}</span>
              <span className="stat__note">{t('كمسوّدات — تُرسل للنشر بعد مراجعتك', 'As drafts — publish them once you have reviewed them')}</span>
            </div>
            <div className="stat">
              <span className="stat__label">{t('متغيّرات أُنشئت', 'Variants created')}</span>
              <span className="stat__value num">{num(report.variantsCreated, locale)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">{t('متغيّرات حُدّثت', 'Variants updated')}</span>
              <span className="stat__value num">{num(report.variantsUpdated, locale)}</span>
              <span className="stat__note">{t('السعر والكمية على SKU موجود', 'Price and quantity on an existing SKU')}</span>
            </div>
          </div>

          <div className="row">
            {report.rejectedCount > 0 ? (
              <button type="button" className="btn btn--primary" onClick={downloadRejected}>
                <Icon name="download" size={16} />
                {t('نزّل الأسطر المرفوضة للتصحيح', 'Download rejected rows to fix')}
              </button>
            ) : null}
            <Link className="btn btn--secondary" href="/vendor/products?status=draft">
              <Icon name="package" size={16} />
              {t('راجع المنتجات المستوردة', 'Review imported products')}
            </Link>
          </div>

          {report.rejectedCount > 0 ? (
            <section className="card card--flush">
              <div className="card__head">
                <h2>{t('الأسطر المرفوضة', 'Rejected rows')}</h2>
                {columns.length > 1 ? (
                  <div className="tabs vp-filter" role="group" aria-label={t('تصفية بالعمود', 'Filter by column')}>
                    <button
                      type="button"
                      className="tabs__tab"
                      aria-pressed={columnFilter === ''}
                      onClick={() => setColumnFilter('')}
                    >
                      {t('الكل', 'All')}
                      <span className="tabs__count">{num(report.rejected.length, locale)}</span>
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
                        <span className="tabs__count">{num(columnCount(c), locale)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('السطر', 'Line')}</th>
                      <th scope="col">SKU</th>
                      <th scope="col">{t('العمود', 'Column')}</th>
                      <th scope="col">{t('السبب', 'Reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) =>
                      r.reasons.map((reason, i) => (
                        <tr key={`${r.line}-${i}`}>
                          <td>
                            {t('سطر', 'Line')} <span className="num">{num(r.line, locale)}</span>
                          </td>
                          <td className="num" data-label="SKU">
                            {r.sku ?? '—'}
                          </td>
                          <td data-label={t('العمود', 'Column')}>
                            <span className="badge badge--pending">{reason.column ?? '—'}</span>
                          </td>
                          <td className="wrap" data-label={t('السبب', 'Reason')}>
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
          <h2>{t('دليل الأعمدة', 'Column guide')}</h2>
        </div>
        <dl className="vp-guide">
          {COLUMN_GUIDE.map((c) => (
            <div key={c.col} className="vp-guide__row">
              <dt className="vp-guide__col">{c.col}</dt>
              <dd>{t(c.desc, c.en)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
