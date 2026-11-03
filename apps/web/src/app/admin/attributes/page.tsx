'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Feedback, Loading, MoreButton } from '@/components/admin';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ClearableInput, EmptyState } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminList } from '@/lib/admin';
import { intlLocale, localized, type Locale } from '@/lib/i18n';

interface Attr {
  id: string;
  code: string;
  nameAr: string;
  inputType: string;
  unit: string | null;
  isFilterable: boolean;
  isVariantAxis: boolean;
  archivedAt: string | null;
  values: { id: string; valueAr: string; hexColor: string | null; _count: Usage & { productImages: number } }[];
  _count: Usage;
}

/** كم منتجاً (بمواصفاته) وكم متغيّراً يستعمل الخصيصة أو القيمة */
interface Usage {
  productValues: number;
  variantOptions: number;
}

const num = (n: number, locale: Locale = 'ar') => n.toLocaleString(intlLocale(locale));

/** «مستعملة في 12 منتجاً و95,017 متغيّراً» — أو «غير مستعملة» */
function usageText(u: Usage & { productImages?: number }, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    const en = [
      u.productValues ? `${num(u.productValues, locale)} ${u.productValues === 1 ? 'product' : 'products'}` : null,
      u.variantOptions ? `${num(u.variantOptions, locale)} ${u.variantOptions === 1 ? 'variant' : 'variants'}` : null,
      u.productImages ? `${num(u.productImages, locale)} ${u.productImages === 1 ? 'image' : 'images'}` : null,
    ].filter((p): p is string => p !== null);
    if (!en.length) return 'Not used';
    return `Used in ${en.length > 1 ? `${en.slice(0, -1).join(', ')} and ${en.at(-1)}` : en[0]}`;
  }
  const parts = [
    u.productValues ? `${num(u.productValues)} منتجاً` : null,
    u.variantOptions ? `${num(u.variantOptions)} متغيّراً` : null,
    u.productImages ? `${num(u.productImages)} صورة` : null,
  ].filter(Boolean);
  return parts.length ? `مستعملة في ${parts.join(' و')}` : 'غير مستعملة';
}

const usedCount = (u: Usage & { productImages?: number }) => u.productValues + u.variantOptions + (u.productImages ?? 0);

const TYPES: Record<string, string> = { select: 'قائمة', multiselect: 'قائمة متعددة', number: 'رقم', text: 'نص', boolean: 'نعم/لا' };
const TYPES_EN: Record<string, string> = { select: 'List', multiselect: 'Multi-select list', number: 'Number', text: 'Text', boolean: 'Yes/No' };

/**
 * AD-09 الخصائص — مكتبة عامة (اللون، المقاس، الضمان…) يستعملها أي منتج. كانت تُربط
 * بشجرة تصنيفات عامة فيرثها فرعها؛ سقطت الشجرة حين صارت الفئات لكل متجر يديرها
 * البائع بلا إدارة (قرار صاحب المشروع 14 أكتوبر 2026). البائع يختار من هنا محاور
 * متغيّراته ومواصفات منتجه.
 */
export default function AdminAttributesPage() {
  const t = useT();
  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('الخصائص', 'Attributes')}
        hint={t(
          'مكتبة عامة يختار منها كل بائع محاور متغيّراته (مقاس، لون) ومواصفات منتجه. فئات المتاجر يديرها البائعون أنفسهم.',
          'A shared library each seller picks their variant axes (size, color) and product specs from. Shop categories are managed by the sellers themselves.',
        )}
      />
      <Attributes />
    </div>
  );
}

type AttrFilter = 'all' | 'axis' | 'filter';

const ATTR_FILTERS: { key: AttrFilter; label: string; en: string }[] = [
  { key: 'all', label: 'الكل', en: 'All' },
  { key: 'axis', label: 'محاور المتغيّرات', en: 'Variant axes' },
  { key: 'filter', label: 'قابلة للتصفية', en: 'Filterable' },
];

/** التصفية والبحث والصفحات من الخادم (3 نوفمبر 2026) — المكتبة قليلة اليوم وتكبر مع كل خصيصة */
function Attributes() {
  const t = useT();
  const locale = useLocale();
  const types = localized(locale, TYPES, TYPES_EN);
  const [filter, setFilter] = useState<AttrFilter>('all');
  const [q, setQ] = useState('');
  const aq = new URLSearchParams({ ...(filter !== 'all' ? { filter } : {}), ...(q.trim() ? { search: q.trim() } : {}) });
  const list = useAdminList<Attr, { counts: Record<AttrFilter, number> }>(`/admin/attributes?${aq}`, (a) => a.id);
  const { data, error, forbidden, reload } = list;
  const act = useAction();
  const [draft, setDraft] = useState({ code: '', nameAr: '', inputType: 'select', unit: '', values: '', isFilterable: true, isVariantAxis: false });
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const shown = list.items;
  const none = data.counts.all === 0;

  return (
    <div className="ac2-page">
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('تصفية الخصائص', 'Filter attributes')}>
          {ATTR_FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
              {t(f.label, f.en)}
              <span className="tabs__count">{data.counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              className="field__control"
              placeholder={t('ابحث باسم الخصيصة أو رمزها', 'Search by attribute name or code')}
              aria-label={t('ابحث في الخصائص', 'Search attributes')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showNew} onClick={() => setShowNew((v) => !v)}>
            <Icon name="plus" size={15} />
            {t('خصيصة جديدة', 'New attribute')}
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showNew ? (
        <section className="card" aria-label={t('خصيصة جديدة', 'New attribute')}>
          <h2 className="ac2-title">{t('خصيصة جديدة', 'New attribute')}</h2>
          <div className="ac2-form">
            <label className="field">
              <span className="field__label">{t('الرمز (لاتيني)', 'Code (Latin letters)')}</span>
              <ClearableInput className="field__control num" dir="ltr" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })} />
            </label>
            <label className="field">
              <span className="field__label">{t('الاسم', 'Name')}</span>
              <ClearableInput className="field__control" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">{t('النوع', 'Type')}</span>
              <select className="field__control" value={draft.inputType} onChange={(e) => setDraft({ ...draft, inputType: e.target.value })}>
                {Object.entries(types).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {draft.inputType === 'number' ? (
              <label className="field">
                <span className="field__label">{t('الوحدة', 'Unit')}</span>
                <ClearableInput className="field__control" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
              </label>
            ) : null}
            {draft.inputType === 'select' || draft.inputType === 'multiselect' ? (
              <label className="field ac2-form__wide">
                <span className="field__label">{t('القيم (مفصولة بفاصلة)', 'Values (comma-separated)')}</span>
                <ClearableInput className="field__control" value={draft.values} onChange={(e) => setDraft({ ...draft, values: e.target.value })} />
              </label>
            ) : null}
            <div className="ac2-form__actions ac2-form__wide">
              <label className="ac2-check">
                <input type="checkbox" checked={draft.isFilterable} onChange={(e) => setDraft({ ...draft, isFilterable: e.target.checked })} />{' '}
                {t('تُفلتر بها النتائج', 'Results can be filtered by it')}
              </label>
              <label className="ac2-check">
                <input type="checkbox" checked={draft.isVariantAxis} onChange={(e) => setDraft({ ...draft, isVariantAxis: e.target.checked })} />{' '}
                {t('محور متغيّرات (مقاس، لون)', 'Variant axis (size, color)')}
              </label>
              <span className="ac2-end">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={act.busy || !draft.code || !draft.nameAr}
                  onClick={() =>
                    void act.run(async () => {
                      const values = draft.values.split(/[,،]/).map((v) => v.trim()).filter(Boolean).map((valueAr) => ({ valueAr }));
                      await api('/admin/attributes', {
                        method: 'POST',
                        body: {
                          code: draft.code,
                          nameAr: draft.nameAr,
                          inputType: draft.inputType,
                          isFilterable: draft.isFilterable,
                          isVariantAxis: draft.isVariantAxis,
                          ...(draft.unit ? { unit: draft.unit } : {}),
                          ...(values.length ? { values } : {}),
                        },
                      });
                      setDraft({ code: '', nameAr: '', inputType: 'select', unit: '', values: '', isFilterable: true, isVariantAxis: false });
                      reload();
                    }, t('أُضيفت الخصيصة.', 'Attribute added.'))
                  }
                >
                  {t('أضف الخصيصة', 'Add attribute')}
                </button>
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="file"
          title={none ? t('لا خصائص بعد', 'No attributes yet') : t('لا خصائص بهذه التصفية', 'No attributes match this filter')}
          actions={
            none ? null : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                {t('أزل التصفية', 'Clear filter')}
              </button>
            )
          }
        >
          {none
            ? t('أضف أول خصيصة من «خصيصة جديدة» — يراها كل بائع في محرّر منتجه.', 'Add the first attribute from “New attribute” — every seller sees it in their product editor.')
            : t('جرّب تصفية أخرى.', 'Try another filter.')}
        </EmptyState>
      ) : (
        <div className="ac2-col">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('الاسم', 'Name')}</th>
                  <th scope="col">{t('الرمز', 'Code')}</th>
                  <th scope="col">{t('النوع', 'Type')}</th>
                  <th scope="col">{t('الوحدة', 'Unit')}</th>
                  <th scope="col">{t('للتصفية', 'Filterable')}</th>
                  <th scope="col">{t('محور', 'Axis')}</th>
                  <th scope="col" className="end">
                    <span className="visually-hidden">{t('إجراء', 'Action')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const isOpen = open === a.id;
                  return (
                    <Fragment key={a.id}>
                    <tr>
                      <td>
                        <span className="ac2-inline">
                          <strong>{a.nameAr}</strong>
                          {a.archivedAt ? <span className="badge badge--pending">{t('مؤرشفة', 'Archived')}</span> : null}
                        </span>
                      </td>
                      <td className="num" data-label={t('الرمز', 'Code')}>
                        {a.code}
                      </td>
                      <td className="small" data-label={t('النوع', 'Type')}>
                        {types[a.inputType] ?? a.inputType}
                      </td>
                      <td className="num ac2-muted-cell" data-label={t('الوحدة', 'Unit')}>
                        {a.unit ?? '—'}
                      </td>
                      <td data-label={t('للتصفية', 'Filterable')}>
                        {a.isFilterable ? <span className="badge badge--success">{t('نعم', 'Yes')}</span> : <span className="badge badge--pending">{t('لا', 'No')}</span>}
                      </td>
                      <td data-label={t('محور', 'Axis')}>{a.isVariantAxis ? <span className="badge badge--brand">{t('محور', 'Axis')}</span> : <span className="badge badge--pending">—</span>}</td>
                      <td className="end" data-label="">
                        <button type="button" className="btn btn--secondary btn--sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.id)}>
                          {isOpen ? t('أغلق', 'Close') : t('حرّر', 'Edit')}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="ac2-expand">
                        <td colSpan={7} data-label="">
                          <AttrEditor key={a.id} attr={a} onChanged={reload} onDeleted={() => (setOpen(null), reload())} />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <MoreButton list={list} />
        </div>
      )}
    </div>
  );
}

/**
 * «حرّر» خصيصة: تصحيح اسمها وأسماء قيمها، وحذف غير المستعمل، وأرشفة المستعمل، وكم يستعملها.
 * كانت تعرض القيم و«أضف قيمة» وحدهما — الخطأ الإملائي لا يُصحَّح إلا من القاعدة، ولا حذف ولا
 * أرشفة (ACFG-099، 1 نوفمبر 2026). الرمز والنوع والمحور ثابتة: المنتجات تشير إليها.
 */
function AttrEditor({ attr: a, onChanged, onDeleted }: { attr: Attr; onChanged: () => void; onDeleted: () => void }) {
  const t = useT();
  const locale = useLocale();
  const act = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState(a.nameAr);
  const [newValue, setNewValue] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const used = usedCount(a._count) > 0;
  const hasValues = a.inputType === 'select' || a.inputType === 'multiselect';
  const base = `/admin/attributes/${a.id}`;

  return (
    <div className="ac2-expand__grid">
      <div className="stack stack--tight">
        <Feedback error={act.error} notice={act.notice} />
        <span className="ac2-fine">
          {usageText(a._count, locale)}
          {a.archivedAt
            ? t(' — مؤرشفة: لا تظهر لمنتج جديد، وتبقى عند المنتجات التي تستعملها.', ' — archived: not offered for new products, and stays on the products that use it.')
            : '.'}
        </span>

        <label className="field__label" htmlFor={`attr-name-${a.id}`}>
          {t('الاسم', 'Name')}
        </label>
        <div className="ac2-inline">
          <ClearableInput id={`attr-name-${a.id}`} className="field__control" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={act.busy || name.trim().length < 2 || name.trim() === a.nameAr}
            onClick={() =>
              void act.run(async () => {
                await api(base, { method: 'PATCH', body: { nameAr: name.trim() } });
                onChanged();
              }, t('حُفظ الاسم.', 'Name saved.'))
            }
          >
            {t('احفظ الاسم', 'Save name')}
          </button>
        </div>
        <span className="ac2-fine">{t('الرمز والنوع والمحور ثابتة — المنتجات تشير إليها.', 'Code, type and axis are fixed — products refer to them.')}</span>

        {hasValues ? (
          <>
            <span className="field__label">{t('القيم', 'Values')}</span>
            {a.values.length ? (
              <div className="stack stack--tight" role="list" aria-label={t(`قيم ${a.nameAr}`, `${a.nameAr} values`)}>
                {a.values.map((v) => {
                  const vUsed = usedCount(v._count) > 0;
                  const draft = editing?.id === v.id ? editing.text : null;
                  return (
                    <div key={v.id} className="ac2-inline" role="listitem">
                      {draft !== null ? (
                        <>
                          <ClearableInput
                            className="field__control"
                            aria-label={t(`الاسم الصحيح لـ «${v.valueAr}»`, `Correct name for “${v.valueAr}”`)}
                            value={draft}
                            onChange={(e) => setEditing({ id: v.id, text: e.target.value })}
                          />
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={act.busy || !draft.trim() || draft.trim() === v.valueAr}
                            onClick={() =>
                              void act.run(async () => {
                                await api(`${base}/values/${v.id}`, { method: 'PATCH', body: { valueAr: draft.trim() } });
                                setEditing(null);
                                onChanged();
                              }, t('صُحّحت القيمة — يراها كل منتج يستعملها.', 'Value corrected — every product using it shows the new name.'))
                            }
                          >
                            {t('احفظ', 'Save')}
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
                            {t('تراجع', 'Cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="badge">
                            {v.hexColor ? <span className="ac2-swatch" style={{ background: v.hexColor }} aria-hidden /> : null}
                            {v.valueAr}
                          </span>
                          <span className="ac2-fine">{usageText(v._count, locale)}</span>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={t(`صحّح «${v.valueAr}»`, `Correct “${v.valueAr}”`)}
                            onClick={() => setEditing({ id: v.id, text: v.valueAr })}
                          >
                            {t('صحّح', 'Correct')}
                          </button>
                          {vUsed ? null : (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={t(`احذف «${v.valueAr}»`, `Delete “${v.valueAr}”`)}
                              disabled={act.busy}
                              onClick={async () => {
                                const sure = await confirm({
                                  title: t(`تحذف «${v.valueAr}»؟`, `Delete “${v.valueAr}”?`),
                                  body: t('لا يستعملها منتج ولا متغيّر — تختفي من خيارات البائعين.', 'No product or variant uses it — it disappears from sellers’ options.'),
                                  confirmLabel: t('احذف القيمة', 'Delete value'),
                                  danger: true,
                                });
                                if (!sure) return;
                                void act.run(async () => {
                                  await api(`${base}/values/${v.id}`, { method: 'DELETE' });
                                  onChanged();
                                }, t('حُذفت القيمة.', 'Value deleted.'));
                              }}
                            >
                              {t('احذف', 'Delete')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="ac2-fine">{t('لا قيم.', 'No values.')}</span>
            )}
            <div className="ac2-inline">
              <ClearableInput
                className="field__control"
                placeholder={t('قيمة جديدة', 'New value')}
                aria-label={t(`قيمة جديدة لـ ${a.nameAr}`, `New value for ${a.nameAr}`)}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={act.busy || !newValue.trim()}
                onClick={() =>
                  void act.run(async () => {
                    await api(`${base}/values`, { method: 'POST', body: { valueAr: newValue.trim() } });
                    setNewValue('');
                    onChanged();
                  }, t('أُضيفت القيمة.', 'Value added.'))
                }
              >
                <Icon name="plus" size={14} />
                {t('أضف قيمة', 'Add value')}
              </button>
            </div>
          </>
        ) : null}

        <div className="ac2-inline">
          {!used ? (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={act.busy}
              onClick={async () => {
                const sure = await confirm({
                  title: t(`تحذف «${a.nameAr}»؟`, `Delete “${a.nameAr}”?`),
                  body: t('لا يستعملها منتج — تُحذف هي وقيمها، ويبقى أثرها في سجل التدقيق.', 'No product uses it — it is deleted with its values, and a trace stays in the audit log.'),
                  confirmLabel: t('احذف الخصيصة', 'Delete attribute'),
                  danger: true,
                });
                if (!sure) return;
                void act.run(async () => {
                  await api(base, { method: 'DELETE' });
                  onDeleted();
                }, t('حُذفت الخصيصة.', 'Attribute deleted.'));
              }}
            >
              {t('احذف الخصيصة', 'Delete attribute')}
            </button>
          ) : a.archivedAt ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  await api(`${base}/restore`, { method: 'POST' });
                  onChanged();
                }, t('استُرجعت الخصيصة — عادت إلى خيارات البائعين.', 'Attribute restored — it is back in sellers’ options.'))
              }
            >
              {t('استرجع الخصيصة', 'Restore attribute')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={act.busy}
              onClick={async () => {
                const sure = await confirm({
                  title: t(`تؤرشف «${a.nameAr}»؟`, `Archive “${a.nameAr}”?`),
                  body: t(
                    'مستعملة فلا تُحذف. تختفي من خيارات البائعين لمنتج جديد، وتبقى عند المنتجات التي تستعملها — ويمكن استرجاعها.',
                    'It is in use, so it cannot be deleted. It disappears from sellers’ options for new products and stays on the products that use it — and it can be restored.',
                  ),
                  confirmLabel: t('أرشف الخصيصة', 'Archive attribute'),
                });
                if (!sure) return;
                void act.run(async () => {
                  await api(`${base}/archive`, { method: 'POST' });
                  onChanged();
                }, t('أُرشفت الخصيصة.', 'Attribute archived.'));
              }}
            >
              {t('أرشف الخصيصة', 'Archive attribute')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
