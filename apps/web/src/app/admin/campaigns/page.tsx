'use client';

import { useEffect, useState } from 'react';
import { AdminHeader, Feedback, Loading, SearchBox } from '@/components/admin';
import { Icon } from '@/components/icons';
import { ClearableInput, EmptyState } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { api } from '@/lib/api';
import { media, useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

type Status = 'live' | 'scheduled' | 'ended' | 'paused';

interface Campaign {
  id: string;
  nameAr: string;
  placement: 'home_top' | 'home_middle';
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  status: Status;
  productCount: number;
  couponId: string | null;
  couponCode: string | null;
  /** المربوط مفعّل وغير منتهٍ — null بلا كوبون */
  couponUsable: boolean | null;
  scope: { shops: number };
}

interface CampaignProduct {
  id: string;
  nameAr: string;
  slug: string;
  status: string;
  isDeleted: boolean;
  shop: { nameAr: string; status?: string };
  visible?: boolean;
  thumbnail: string | null;
}

interface Detail extends Omit<Campaign, 'productCount' | 'scope'> {
  products: CampaignProduct[];
}

interface SearchHit {
  id: string;
  nameAr: string;
  slug: string;
  shop: { nameAr: string };
  thumbnail: string | null;
}

interface CouponOption {
  id: string;
  code: string;
  endsAt: string | null;
}

const MAX = 24;
const PLACEMENTS: Record<Campaign['placement'], string> = { home_top: 'أعلى الرئيسية', home_middle: 'منتصف الرئيسية' };
const STATUS: Record<Status, { label: string; tone: string }> = {
  live: { label: 'جارية', tone: 'badge--success' },
  scheduled: { label: 'مجدولة', tone: 'badge--info' },
  ended: { label: 'منتهية', tone: 'badge--pending' },
  paused: { label: 'موقوفة', tone: 'badge--warning' },
};
const FILTERS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'live', label: 'جارية' },
  { key: 'scheduled', label: 'مجدولة' },
  { key: 'ended', label: 'منتهية' },
  { key: 'paused', label: 'موقوفة' },
];

/** العدد العربي مع معدوده: واحد، مثنّى، جمع قلّة (3–10)، تمييز مفرد (11+) */
const counted = (n: number, one: string, two: string, few: string, many: string) =>
  n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;

const productsLabel = (n: number) => (n === 0 ? 'بلا منتجات بعد' : counted(n, 'منتج مميّز واحد', 'منتجان مميّزان', 'منتجات مميّزة', 'منتجاً مميّزاً'));

const scopeOf = (c: Campaign) => {
  if (c.productCount === 0) return '—';
  return counted(c.scope.shops, 'متجر واحد', 'متجران', 'متاجر', 'متجراً');
};

const day = (iso: string) => new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long' }).format(new Date(iso));

/** قيمة حقل datetime-local بتوقيت المتصفّح من لحظة ISO */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EMPTY = { nameAr: '', placement: 'home_top' as Campaign['placement'], startsAt: '', endsAt: '', couponId: '' };

/**
 * AD-17 — الحملات والمنتجات المميّزة. مدة وموضع في الرئيسية ومنتجات مرتّبة
 * يدوياً، وكوبون يُعلَن معها (يعمل بشروطه هو). الحملة لا تُحذف: تُوقف فتختفي
 * من الواجهة فوراً وتبقى في السجل.
 */
export default function AdminCampaignsPage() {
  const { data, error, forbidden, reload } = useAdminData<Campaign[]>('/admin/campaigns');
  const act = useAction();
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [q, setQ] = useState('');
  // picked: رمز المختار ليبقى ظاهراً ولو خرج من نتائج البحث، وusable=false إن لم يعد صالحاً
  const [form, setForm] = useState<{ id: string | null; couponId: string | null; picked: { code: string; usable: boolean } | null; v: typeof EMPTY } | null>(null);
  // «كوبون يُعلَن» بحثاً برمزه وأوّل عشرين — كانت كل الكوبونات المفعّلة قائمة واحدة (ACFG-039، 31 أكتوبر 2026)
  const [couponSearch, setCouponSearch] = useState('');
  const cq = new URLSearchParams(couponSearch.trim() ? { q: couponSearch.trim() } : {});
  const coupons = useAdminData<{ items: CouponOption[]; total: number }>(form ? `/admin/campaigns/coupon-options?${cq}` : null);
  const [ordering, setOrdering] = useState<string | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const term = q.trim();
  const shown = data.filter((c) => filter === 'all' || c.status === filter).filter((c) => !term || c.nameAr.includes(term));

  const openNew = () => (setOrdering(null), setCouponSearch(''), setForm({ id: null, couponId: null, picked: null, v: EMPTY }));
  const openEdit = (c: Campaign) => (
    setOrdering(null),
    setCouponSearch(''),
    setForm({
      id: c.id,
      couponId: c.couponId,
      picked: c.couponId && c.couponCode ? { code: c.couponCode, usable: c.couponUsable !== false } : null,
      v: { nameAr: c.nameAr, placement: c.placement, startsAt: toLocalInput(c.startsAt), endsAt: toLocalInput(c.endsAt), couponId: c.couponId ?? '' },
    })
  );

  const save = () => {
    if (!form) return;
    const v = form.v;
    const body: Record<string, unknown> = {
      nameAr: v.nameAr.trim(),
      placement: v.placement,
      startsAt: new Date(v.startsAt).toISOString(),
      endsAt: new Date(v.endsAt).toISOString(),
    };
    // الكوبون يُرسل حين يتغيّر وحده — كوبون أُوقف بعد ربطه لا يمنع تعديل الاسم
    if (!form.id || (v.couponId || null) !== form.couponId) body['couponId'] = v.couponId || null;
    void act.run(async () => {
      if (form.id) await api(`/admin/campaigns/${form.id}`, { method: 'PATCH', body });
      else await api('/admin/campaigns', { method: 'POST', body });
      setForm(null);
      reload();
    }, form.id ? 'حُفظت الحملة.' : 'أُنشئت الحملة — رتّب منتجاتها الآن.');
  };

  const toggle = (c: Campaign) =>
    void act.run(async () => {
      await api(`/admin/campaigns/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
      reload();
    }, c.isActive ? `أُوقفت «${c.nameAr}» واختفت من الرئيسية.` : `فُعِّلت «${c.nameAr}».`);

  const formValid = form && form.v.nameAr.trim().length >= 3 && form.v.startsAt && form.v.endsAt && new Date(form.v.endsAt) > new Date(form.v.startsAt);
  const current = ordering ? data.find((c) => c.id === ordering) : null;

  return (
    <div className="ac2-page">
      <AdminHeader title="الحملات والمنتجات المميّزة" hint="مدة وموضع في الرئيسية ومنتجات مرتّبة يدوياً، وكوبون يُعلَن معها." />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="تصفية الحملات">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.label}
              <span className="tabs__count">{x.key === 'all' ? data.length : data.filter((c) => c.status === x.key).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder="ابحث باسم الحملة" aria-label="ابحث باسم الحملة" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={!!form && !form.id} onClick={() => (form && !form.id ? setForm(null) : openNew())}>
            <Icon name="plus" size={15} />
            حملة جديدة
          </button>
        </div>
      </div>

      <div className="alert alert--info ac2-callout">
        <Icon name="info" size={16} />
        <span>المنتجات المميّزة داخل كل حملة تُرتَّب يدوياً — افتح «رتّب المنتجات» لترتيبها بالأسهم أو بالسحب. الحملة الجارية تظهر في موضعها من الرئيسية حتى موعد انتهائها.</span>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {form ? (
        <section className="card" aria-label={form.id ? 'تحرير الحملة' : 'حملة جديدة'}>
          <h2 className="ac2-title">{form.id ? 'تحرير الحملة' : 'حملة جديدة'}</h2>
          <p className="ac2-hint">المدة والموضع والكوبون المُعلَن. المنتجات تُضاف وتُرتَّب بعد الحفظ من «رتّب المنتجات».</p>
          <div className="ac2-form">
            <label className="field ac2-form__wide">
              <span className="field__label">اسم الحملة</span>
              <ClearableInput className="field__control" maxLength={80} value={form.v.nameAr} onChange={(e) => setForm({ ...form, v: { ...form.v, nameAr: e.target.value } })} />
            </label>
            <label className="field">
              <span className="field__label">الموضع</span>
              <select className="field__control" value={form.v.placement} onChange={(e) => setForm({ ...form, v: { ...form.v, placement: e.target.value as Campaign['placement'] } })}>
                {Object.entries(PLACEMENTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field__label">تبدأ</span>
              <DateField withTime label="تبدأ" value={form.v.startsAt} onChange={(v) => setForm({ ...form, v: { ...form.v, startsAt: v } })} />
            </div>
            <div className="field">
              <span className="field__label">تنتهي</span>
              <DateField withTime label="تنتهي" value={form.v.endsAt} onChange={(v) => setForm({ ...form, v: { ...form.v, endsAt: v } })} />
            </div>
            <div className="field ac2-form__wide">
              <span className="field__label" id="campaign-coupon">
                كوبون يُعلَن (اختياري)
              </span>
              <div className="ac2-pick">
                <SearchBox value={couponSearch} onChange={setCouponSearch} placeholder="ابحث برمز الكوبون" label="ابحث عن كوبون" className="ac2-search" />
                <select
                  className="field__control"
                  aria-labelledby="campaign-coupon"
                  value={form.v.couponId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      picked: e.target.value ? { code: e.target.selectedOptions[0]?.text ?? '', usable: true } : null,
                      v: { ...form.v, couponId: e.target.value },
                    })
                  }
                >
                  <option value="">بلا كوبون</option>
                  {/* المختار يبقى ظاهراً ولو خرج من نتائج البحث — وكوبون أُوقف بعد ربطه يُعلَّم ليُفهم الاختيار — قبل سطر النتائج كي لا يُقرأ «لا كوبون» فوقه */}
                  {form.v.couponId && form.picked && !(coupons.data?.items ?? []).some((c) => c.id === form.v.couponId) ? (
                    <option value={form.v.couponId}>{form.picked.usable ? form.picked.code : `${form.picked.code} (غير صالح الآن)`}</option>
                  ) : null}
                  {!coupons.data ? null : coupons.data.total === 0 ? (
                    <option disabled>لا كوبون مفعّل بهذا الرمز</option>
                  ) : coupons.data.total > coupons.data.items.length ? (
                    <option disabled>{`أوّل ${coupons.data.items.length} من ${coupons.data.total} — ضيّق بالبحث`}</option>
                  ) : null}
                  {(coupons.data?.items ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {form.v.startsAt && form.v.endsAt && new Date(form.v.endsAt) <= new Date(form.v.startsAt) ? (
            <p className="field__error" role="alert">
              نهاية الحملة بعد بدايتها.
            </p>
          ) : null}
          <div className="ac2-form__actions">
            <button type="button" className="btn btn--primary" disabled={act.busy || !formValid} onClick={save}>
              {form.id ? 'احفظ التعديل' : 'أنشئ الحملة'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setForm(null)}>
              إلغاء
            </button>
          </div>
        </section>
      ) : null}

      {current ? <OrderPanel key={current.id} campaign={current} onClose={() => setOrdering(null)} onSaved={reload} /> : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="chart"
          title={data.length === 0 ? 'لا حملات بعد' : 'لا حملات بهذه التصفية'}
          actions={
            data.length === 0 ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={openNew}>
                <Icon name="plus" size={14} />
                حملة جديدة
              </button>
            ) : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                أزل التصفية
              </button>
            )
          }
        >
          {data.length === 0 ? 'أنشئ أول حملة: مدتها وموضعها في الرئيسية، ثم رتّب منتجاتها.' : 'جرّب تصفية أخرى أو أنشئ حملة.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">الحملة</th>
                <th scope="col">المدة</th>
                <th scope="col">النطاق</th>
                <th scope="col">الكوبون</th>
                <th scope="col">الموضع</th>
                <th scope="col">الحالة</th>
                <th scope="col" className="end">
                  <span className="visually-hidden">إجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} data-tone={ordering === c.id ? 'selected' : c.status === 'ended' ? 'muted' : undefined}>
                  <td>
                    <span className="ac2-cell">
                      <span className="ac2-cell__main">{c.nameAr}</span>
                      <span className="ac2-cell__sub">{productsLabel(c.productCount)}</span>
                    </span>
                  </td>
                  <td className="ac2-muted-cell" data-label="المدة">
                    <span title={`${when(c.startsAt)} — ${when(c.endsAt)}`}>
                      {day(c.startsAt)} – {day(c.endsAt)}
                    </span>
                  </td>
                  <td className="ac2-muted-cell" data-label="النطاق">
                    {scopeOf(c)}
                  </td>
                  <td data-label="الكوبون">{c.couponCode ? <span className="num ac2-campaign-code">{c.couponCode}</span> : <span className="ac2-faint">—</span>}</td>
                  <td className="ac2-muted-cell" data-label="الموضع">
                    {PLACEMENTS[c.placement] ?? c.placement}
                  </td>
                  <td data-label="الحالة">
                    <span className={`badge ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span>
                  </td>
                  <td className="end" data-label="">
                    <span className="ac2-actions">
                      <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => openEdit(c)} aria-label={`حرّر ${c.nameAr}`}>
                        حرّر
                      </button>
                      {c.status !== 'ended' ? (
                        <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => toggle(c)} aria-label={`${c.isActive ? 'أوقف' : 'فعّل'} ${c.nameAr}`}>
                          {c.isActive ? 'أوقف' : 'فعّل'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        aria-expanded={ordering === c.id}
                        onClick={() => (setForm(null), setOrdering(ordering === c.id ? null : c.id))}
                        aria-label={`رتّب منتجات ${c.nameAr}`}
                      >
                        رتّب المنتجات
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * ترتيب منتجات الحملة: الأسهم للوحة المفاتيح وقارئ الشاشة، والسحب للفأرة.
 * التعديل محلي حتى «احفظ الترتيب» — يُستبدل كله في معاملة واحدة في الخادم.
 */
function OrderPanel({ campaign, onClose, onSaved }: { campaign: Campaign; onClose: () => void; onSaved: () => void }) {
  const detail = useAdminData<Detail>(`/admin/campaigns/${campaign.id}`);
  const act = useAction();
  // المسوّدة المحلية؛ قبل أول تعديل هي ما في الخادم
  const [draft, setItems] = useState<CampaignProduct[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');

  // البحث بعد توقّف الكتابة — المنشور وحده، بالاسم أو المتجر
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      void api<SearchHit[]>(`/admin/campaigns/product-search${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [term]);

  const items = draft ?? detail.data?.products ?? null;
  if (!items) return <Loading error={detail.error} forbidden={detail.forbidden} inline />;

  const update = (next: CampaignProduct[], message: string) => {
    setItems(next);
    setDirty(true);
    setAnnounce(message);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    update(next, `${x!.nameAr}: الموضع ${to + 1} من ${next.length}`);
  };
  const ids = new Set(items.map((p) => p.id));
  const full = items.length >= MAX;

  const save = () =>
    void act.run(async () => {
      await api(`/admin/campaigns/${campaign.id}/products`, { method: 'PUT', body: { productIds: items.map((p) => p.id) } });
      setDirty(false);
      onSaved();
    }, 'حُفظ ترتيب المنتجات.');

  return (
    <section className="card card--flush" aria-labelledby="ac2-order-title">
      <header className="card__head ac2-order__head">
        <h2 id="ac2-order-title" className="ac2-title">
          منتجات «{campaign.nameAr}»
        </h2>
        <span className="ac2-hint">بالترتيب الظاهر في الرئيسية — حتى {MAX} منتجاً منشوراً.</span>
        <span className="ac2-end">
          <span className="num ac2-hint">
            {items.length} / {MAX}
          </span>
          <button type="button" className="icon-btn icon-btn--sm" onClick={onClose} aria-label="أغلق الترتيب">
            <Icon name="x" size={15} />
          </button>
        </span>
      </header>

      <span className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </span>

      {items.length === 0 ? (
        <p className="ac2-section-empty">لا منتجات في الحملة بعد — ابحث عن منتج منشور أدناه وأضفه.</p>
      ) : (
        <ol className="ac2-rank">
          {items.map((p, i) => (
            <li
              key={p.id}
              className="ac2-rank__item ac2-order__item"
              draggable
              data-dragging={drag === i || undefined}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <Icon name="grip" size={15} className="ac2-order__grip" />
              <span className="ac2-rank__num">{i + 1}</span>
              {p.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media(p.thumbnail) ?? ''} alt="" className="ac2-order__thumb" />
              ) : (
                <span className="ac2-order__thumb" aria-hidden />
              )}
              <span className="ac2-cell ac2-order__name">
                <span className="ac2-cell__main">{p.nameAr}</span>
                <span className="ac2-cell__sub">{p.shop.nameAr}</span>
              </span>
              {p.visible === false ? <span className="badge badge--warning">مخفي من الواجهة</span> : null}
              <span className="ac2-order__btns">
                <button type="button" className="icon-btn icon-btn--sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`انقل ${p.nameAr} أعلى`}>
                  <Icon name="chev-down" size={14} className="ac2-flip" />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} aria-label={`انقل ${p.nameAr} أسفل`}>
                  <Icon name="chev-down" size={14} />
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => update(items.filter((x) => x.id !== p.id), `أُزيل ${p.nameAr}`)} aria-label={`أزل ${p.nameAr}`}>
                  إزالة
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="card__body ac2-order__add">
        <label className="input-icon ac2-order__search">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="field__control"
            placeholder="ابحث عن منتج منشور بالاسم أو المتجر"
            aria-label="ابحث عن منتج منشور لإضافته"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        {results.filter((r) => !ids.has(r.id)).length === 0 ? (
          <p className="ac2-fine">{term.trim() ? 'لا منتجات منشورة مطابقة خارج الحملة.' : 'لا منتجات منشورة أخرى.'}</p>
        ) : (
          <ul className="ac2-order__results" aria-label="نتائج البحث">
            {results
              .filter((r) => !ids.has(r.id))
              .map((r) => (
                <li key={r.id} className="ac2-order__result">
                  <span className="ac2-cell ac2-order__name">
                    <span className="ac2-cell__main">{r.nameAr}</span>
                    <span className="ac2-cell__sub">{r.shop.nameAr}</span>
                  </span>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={full} onClick={() => update([...items, { ...r, status: 'active', isDeleted: false, visible: true }], `أُضيف ${r.nameAr} في الموضع ${items.length + 1}`)} aria-label={`أضف ${r.nameAr}`}>
                    <Icon name="plus" size={14} />
                    أضف
                  </button>
                </li>
              ))}
          </ul>
        )}
        {full ? <p className="ac2-fine">بلغت الحملة {MAX} منتجاً — أزل منتجاً لتضيف غيره.</p> : null}

        <Feedback error={act.error} notice={act.notice} />
        <div className="ac2-form__actions">
          <button type="button" className="btn btn--primary" disabled={act.busy || !dirty} onClick={save}>
            احفظ الترتيب
          </button>
          {dirty ? <span className="ac2-hint">تغييرات لم تُحفظ.</span> : null}
        </div>
      </div>
    </section>
  );
}
