'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading, MoreButton, SearchBox } from '@/components/admin';
import { Icon } from '@/components/icons';
import { Alert, ClearableInput, EmptyState } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { useLocale, useT } from '@/components/locale';
import { localized } from '@/lib/i18n';
import { api } from '@/lib/api';
import { media, useAction, useAdminData, useAdminList } from '@/lib/admin';
import { when } from '@/lib/orders';
import { fold } from '@/lib/arabic-fold';

interface Banner {
  id: string;
  placement: string;
  imageKey: string;
  imageUrl: string;
  linkUrl: string | null;
  titleAr: string | null;
  sort: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

const PLACEMENTS: Record<string, string> = { home_hero: 'أعلى الرئيسية', home_middle: 'وسط الرئيسية' };
const PLACEMENTS_EN: Record<string, string> = { home_hero: 'Top of home page', home_middle: 'Middle of home page' };
/** لافتات «أعلى صفحة التصنيف» القديمة — بلا صفحة تظهر فيها منذ صارت الفئات لكل متجر، فأُطفئت */
const RETIRED: Record<string, string> = { category_top: 'أعلى صفحة التصنيف (أُلغي الموضع)' };
const RETIRED_EN: Record<string, string> = { category_top: 'Top of category page (placement retired)' };

/** المنتج درجةً أعلى في ترتيب المميّز */
function up(ids: string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i <= 0) return ids;
  const next = [...ids];
  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
  return next;
}

type Filter = 'all' | 'home';

const FILTERS: { key: Filter; label: string; en: string; test: (b: Banner) => boolean }[] = [
  { key: 'all', label: 'الكل', en: 'All', test: () => true },
  { key: 'home', label: 'الرئيسية', en: 'Home page', test: (b: Banner) => b.placement.startsWith('home_') },
];

/**
 * AD-17 و AD-19 — اللافتات والمنتجات المميّزة. الصورة تُرفع أولاً فتُحوَّل
 * WebP بعرض 1600، ثم تُحفظ اللافتة بمفتاحها. المميّز منتجات منشورة فقط،
 * بالترتيب الذي تضعه هنا.
 *
 * المنتج المميّز يُختار ببحث، والقائمة تأتي بأسمائها من الخادم (20 أكتوبر 2026): كانت الأسماء
 * والاختيار من أحدث مئة منتج منشور، فما سواها يظهر بأول معرّفه ولا يُضاف.
 */
export default function AdminStorefrontPage() {
  const t = useT();
  const locale = useLocale();
  const placements = localized(locale, PLACEMENTS, PLACEMENTS_EN);
  const retired = localized(locale, RETIRED, RETIRED_EN);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  // اللافتات بالموضع والبحث وصفحاتها من الخادم (3 نوفمبر 2026) — كانت 223 لافتة تُجلب كلها
  const bq = new URLSearchParams({ ...(filter !== 'all' ? { filter } : {}), ...(q.trim() ? { search: q.trim() } : {}) });
  const banners = useAdminList<Banner, { counts: Record<Filter, number>; placements: Record<string, number> }>(`/admin/banners?${bq}`, (b) => b.id);
  const featured = useAdminData<{ id: string; nameAr: string | null; vendor: string | null; active: boolean }[]>('/admin/storefront/featured');
  const [productSearch, setProductSearch] = useState('');
  const pq = new URLSearchParams({ status: 'active', pageSize: '20', ...(productSearch.trim() ? { search: productSearch.trim() } : {}) });
  const products = useAdminData<{ items: { id: string; nameAr: string; vendor: { nameAr: string } }[]; total: number }>(`/admin/products?${pq}`);
  const act = useAction();
  // رسالة المميّز عنده: تحت مئات اللافتات كان رفضه يظهر أعلى الصفحة فلا يُرى
  const featuredAct = useAction();
  const [draft, setDraft] = useState({ placement: 'home_hero', titleAr: '', linkUrl: '/shops', imageKey: '', imageUrl: '', startsAt: '', endsAt: '' });
  const [showNew, setShowNew] = useState(false);

  const upload = async (file: File) => {
    await act.run(async () => {
      const json = await api<{ imageKey: string; imageUrl: string }>('/admin/banners/image', { method: 'POST', file });
      setDraft((d) => ({ ...d, imageKey: json.imageKey, imageUrl: json.imageUrl }));
    }, t('رُفعت الصورة.', 'Image uploaded.'));
  };

  const saveFeatured = (ids: string[]) =>
    featuredAct.run(async () => {
      await api('/admin/storefront/featured', { method: 'PUT', body: { productIds: ids } });
      featured.reload();
    }, t('حُفظ المميّز.', 'Featured products saved.'));

  if (!banners.data) return <Loading error={banners.error} forbidden={banners.forbidden} />;
  const all = banners.data;
  // ما لم يعد منشوراً يظهر معلَّماً ويبقى في كل حفظ، فيرفضه الخادم «كل المميّز منتجات منشورة.» حتى
  // يُزال بيده. كان يسقط بصمت مع تحريك منتج غيره فيختفي بلا سبب يُرى (ACFG-054، 3 نوفمبر 2026)
  const rows = featured.data ?? [];
  const ids = rows.map((p) => p.id);
  const test = FILTERS.find((x) => x.key === filter)?.test ?? (() => true);
  const term = fold(q.trim());
  // الخادم صفّى وبحث؛ والشرط نفسه هنا يُخفي صفوف التصفية السابقة ما دامت الصفحة الجديدة في الطريق
  // (تبقى على الشاشة حتى تصل). بالتوحيد نفسه، وإلا أخفى «الاولى» ما وجده الخادم من «الأولى»
  const shown = all.items.filter(test).filter((b) => !term || fold(b.titleAr ?? '').includes(term));
  const { counts, placements: perPlacement } = all;
  const none = counts.all === 0;

  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('الواجهة واللافتات', 'Storefront and banners')}
        hint={t('اللافتات بمواضعها وجدولتها، والمنتجات المميّزة في الرئيسية.', 'Banners with their placements and schedules, and the featured products on the home page.')}
      />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('تصفية اللافتات', 'Filter banners')}>
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {t(x.label, x.en)}
              <span className="tabs__count">{counts[x.key]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder={t('ابحث بعنوان اللافتة', 'Search by banner title')} aria-label={t('ابحث بعنوان اللافتة', 'Search by banner title')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showNew} onClick={() => setShowNew((v) => !v)}>
            <Icon name="plus" size={15} />
            {t('لافتة جديدة', 'New banner')}
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showNew ? (
        <section className="card" aria-label={t('لافتة جديدة', 'New banner')}>
          <h2 className="ac2-title">{t('لافتة جديدة', 'New banner')}</h2>
          <p className="ac2-hint">
            {t(
              'الصورة أولاً (600 بكسل عرضاً على الأقل)، ثم الموضع والعنوان والرابط والجدولة.',
              'Image first (at least 600 pixels wide), then placement, title, link, and schedule.',
            )}
          </p>
          <div className="ac2-form">
            <label className="field ac2-form__wide">
              <span className="field__label">{t('الصورة (600 بكسل عرضاً على الأقل)', 'Image (at least 600 pixels wide)')}</span>
              <input type="file" accept="image/*" className="field__control" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </label>
            <label className="field">
              <span className="field__label">{t('الموضع', 'Placement')}</span>
              <select className="field__control" value={draft.placement} onChange={(e) => setDraft({ ...draft, placement: e.target.value })}>
                {Object.entries(placements).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t('العنوان', 'Title')}</span>
              <ClearableInput className="field__control" value={draft.titleAr} onChange={(e) => setDraft({ ...draft, titleAr: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">{t('الرابط (مسار داخلي)', 'Link (internal path)')}</span>
              <ClearableInput className="field__control num" dir="ltr" value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
            </label>
            <div className="field">
              <span className="field__label">{t('يبدأ', 'Starts')}</span>
              <DateField withTime clearable label={t('يبدأ', 'Starts')} value={draft.startsAt} onChange={(v) => setDraft({ ...draft, startsAt: v })} />
            </div>
            <div className="field">
              <span className="field__label">{t('ينتهي', 'Ends')}</span>
              <DateField withTime clearable label={t('ينتهي', 'Ends')} value={draft.endsAt} onChange={(v) => setDraft({ ...draft, endsAt: v })} />
            </div>
          </div>
          {draft.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media(draft.imageUrl) ?? ''} alt={t('معاينة', 'Preview')} className="ac2-preview-img" />
          ) : null}
          <div className="ac2-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || !draft.imageKey}
              onClick={() =>
                void act.run(async () => {
                  await api('/admin/banners', {
                    method: 'POST',
                    body: {
                      placement: draft.placement,
                      imageKey: draft.imageKey,
                      titleAr: draft.titleAr || null,
                      linkUrl: draft.linkUrl || null,
                      // في آخر موضعها — بعدد لافتاته كلها لا بما في الصفحة
                      sort: perPlacement[draft.placement] ?? 0,
                      isActive: true,
                      ...(draft.startsAt ? { startsAt: new Date(draft.startsAt).toISOString() } : {}),
                      ...(draft.endsAt ? { endsAt: new Date(draft.endsAt).toISOString() } : {}),
                    },
                  });
                  setDraft({ ...draft, imageKey: '', imageUrl: '', titleAr: '' });
                  banners.reload();
                }, t('نُشرت اللافتة.', 'Banner published.'))
              }
            >
              {t('انشر اللافتة', 'Publish banner')}
            </button>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="image"
          title={none ? t('لا لافتات بعد', 'No banners yet') : t('لا لافتات بهذه التصفية', 'No banners match this filter')}
          actions={
            none ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowNew(true)}>
                <Icon name="plus" size={14} />
                {t('لافتة جديدة', 'New banner')}
              </button>
            ) : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                {t('أزل التصفية', 'Clear filters')}
              </button>
            )
          }
        >
          {none
            ? t('ارفع صورة لافتة واختر موضعها في الواجهة.', 'Upload a banner image and choose its placement on the storefront.')
            : t('جرّب تصفية أخرى أو أضف لافتة.', 'Try another filter or add a banner.')}
        </EmptyState>
      ) : (
        <div className="ac2-col">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('اللافتة', 'Banner')}</th>
                  <th scope="col">{t('الموضع', 'Placement')}</th>
                  <th scope="col">{t('الترتيب', 'Order')}</th>
                  <th scope="col">{t('الجدولة', 'Schedule')}</th>
                  <th scope="col" className="end">
                    {t('ظاهرة', 'Visible')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} data-tone={b.isActive ? undefined : 'off'}>
                    <td>
                      <span className="ac2-banner">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={media(b.imageUrl) ?? ''} alt="" className="ac2-thumb" />
                        <span className="ac2-cell">
                          <span className="ac2-cell__main">{b.titleAr ?? '—'}</span>
                          <span className="ac2-cell__sub num">{b.linkUrl ?? '—'}</span>
                        </span>
                      </span>
                    </td>
                    <td className="ac2-muted-cell" data-label={t('الموضع', 'Placement')}>
                      {placements[b.placement] ?? retired[b.placement] ?? b.placement}
                    </td>
                    <td className="num" data-label={t('الترتيب', 'Order')}>
                      {/* كان رقماً وحده بلا أداة لتغييره (ACFG-052) — الأسهم بين ظاهرات الموضع */}
                      <span className="ac2-sortcell">
                        {b.sort}
                        {([
                          ['up', t(`انقل ${b.titleAr ?? 'اللافتة'} للأعلى`, `Move ${b.titleAr ?? 'banner'} up`)],
                          ['down', t(`انقل ${b.titleAr ?? 'اللافتة'} للأسفل`, `Move ${b.titleAr ?? 'banner'} down`)],
                        ] as const).map(([direction, label]) => (
                          <button
                            key={direction}
                            type="button"
                            className="icon-btn icon-btn--sm"
                            aria-label={label}
                            title={b.isActive ? label : t('أظهر اللافتة أولاً لترتّبها.', 'Show the banner first to reorder it.')}
                            disabled={act.busy || !b.isActive}
                            onClick={() =>
                              void act.run(async () => {
                                await api(`/admin/banners/${b.id}/move`, { method: 'POST', body: { direction } });
                                banners.reload();
                              })
                            }
                          >
                            <Icon name="chev-down" size={14} {...(direction === 'up' ? { className: 'ac2-flip' } : {})} />
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className="ac2-muted-cell" data-label={t('الجدولة', 'Schedule')}>
                      {b.startsAt ? when(b.startsAt, locale) : t('الآن', 'Now')} — {b.endsAt ? when(b.endsAt, locale) : t('مفتوح', 'Open-ended')}
                    </td>
                    <td className="end" data-label={t('ظاهرة', 'Visible')}>
                      <button
                        type="button"
                        role="switch"
                        className="ac2-switch"
                        aria-checked={b.isActive}
                        aria-label={t(`إظهار ${b.titleAr ?? 'اللافتة'}`, `Show ${b.titleAr ?? 'banner'}`)}
                        disabled={act.busy}
                        onClick={() =>
                          void act.run(async () => {
                            await api(`/admin/banners/${b.id}`, {
                              method: 'PATCH',
                              body: { placement: b.placement, imageKey: b.imageKey, linkUrl: b.linkUrl, titleAr: b.titleAr, sort: b.sort, startsAt: b.startsAt, endsAt: b.endsAt, isActive: !b.isActive },
                            });
                            banners.reload();
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreButton list={banners} />
        </div>
      )}

      <section className="card card--flush" aria-label={t('المنتجات المميّزة في الرئيسية', 'Featured products on the home page')}>
        <header className="card__head">
          <h2 className="ac2-title">{t('المنتجات المميّزة في الرئيسية', 'Featured products on the home page')}</h2>
          <span className="ac2-hint">{t('بالترتيب الظاهر — حتى 24 منتجاً منشوراً.', 'In the order shown — up to 24 published products.')}</span>
          <span className="ac2-end num ac2-hint">{ids.length} / 24</span>
        </header>
        {featuredAct.error ? (
          <div className="card__body">
            <Alert tone="danger">{featuredAct.error}</Alert>
          </div>
        ) : null}
        <Feedback error={null} notice={featuredAct.notice} />
        {rows.length === 0 ? (
          <p className="ac2-section-empty">
            {t('لا منتجات مميّزة بعد — أضف منتجاً منشوراً من القائمة أدناه.', 'No featured products yet — add a published product from the list below.')}
          </p>
        ) : (
          <ol className="ac2-rank">
            {rows.map((p, i) => (
              <li key={p.id} className="ac2-rank__item">
                <span className="ac2-rank__num">{i + 1}</span>
                <span className="ac2-rank__name">
                  {p.nameAr ?? p.id.slice(0, 8)}
                  {p.vendor ? <span className="ac2-hint"> — {p.vendor}</span> : null}
                  {p.active ? null : <span className="badge badge--warning">{t('لم يعد منشوراً — أزله قبل أي تغيير', 'No longer published — remove it before any change')}</span>}
                </span>
                <button type="button" className="icon-btn icon-btn--sm" disabled={i === 0 || !p.active} onClick={() => void saveFeatured(up(ids, p.id))} aria-label={t('أعلى', 'Move up')}>
                  <Icon name="chev-down" size={14} className="ac2-flip" />
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveFeatured(ids.filter((x) => x !== p.id))}>
                  {t('إزالة', 'Remove')}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="card__body">
          <div className="ac2-pick">
            <SearchBox
              value={productSearch}
              onChange={setProductSearch}
              placeholder={t('ابحث باسم المنتج أو المتجر', 'Search by product or shop name')}
              label={t('ابحث عن منتج منشور', 'Search for a published product')}
              className="ac2-search"
            />
            <select className="field__control" value="" onChange={(e) => e.target.value && void saveFeatured([...ids, e.target.value])} aria-label={t('أضف منتجاً', 'Add a product')}>
              <option value="">
                {!products.data
                  ? '…'
                  : products.data.total > products.data.items.length
                    ? t(
                        `أضف منتجاً — أول ${products.data.items.length} من ${products.data.total}، ضيّق بالبحث`,
                        `Add a product — first ${products.data.items.length} of ${products.data.total}, narrow with search`,
                      )
                    : products.data.total === 0
                      ? t('لا منتج منشور بهذا البحث', 'No published product matches this search')
                      : t('أضف منتجاً منشوراً…', 'Add a published product…')}
              </option>
              {(products.data?.items ?? [])
                .filter((p) => !ids.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr} — {p.vendor.nameAr}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
