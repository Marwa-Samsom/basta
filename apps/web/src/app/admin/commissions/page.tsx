'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading, MoreButton, SearchBox } from '@/components/admin';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData, useAdminList, VENDOR_STATUS, VENDOR_STATUS_EN } from '@/lib/admin';
import { when } from '@/lib/orders';
import { ClearableInput } from '@/components/ui';

interface Rule {
  id: string;
  scope: 'global' | 'vendor';
  vendorId: string | null;
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  vendor: { nameAr: string } | null;
}

interface VendorItem {
  id: string;
  nameAr: string;
  slug: string;
  status: string;
}

/** متاجر الاختيار في كل بحث — أكثر منها يُضيَّق بالبحث لا بالتمرير */
const PICK = 20;

/**
 * AD-10 — العمولة: نسبة على كل منتج يُباع بغضّ النظر عن فئته أو سعره، عامة لكل
 * المنصّة أو خاصة بمتجر (قرار صاحب المشروع 14 أكتوبر 2026 — ألغى مستوى الفئة).
 * القاعدة لا تُحذف: الجديدة تُنهي السابقة بتاريخ، وكل طلب سابق على لقطته.
 *
 * المتجر يُختار ببحث (20 أكتوبر 2026): القائمة كانت أقدم مئة متجر معتمد، فما بعدها — «غزة»
 * بين آلاف متاجر الاختبار — لا تُعطى نسبة خاصة.
 *
 * ومن مسار العمولة نفسه (4 نوفمبر 2026، ACFG-014): كانت القائمة من طابور المراجعة — يحتاج vendors.review
 * فبقي مدير العمولات وحدها على «…» بلا سبب — والمعتمد وحده فيها، فالمتجر قيد المراجعة (ينشر قبل اعتماده)
 * لا تُعطى له نسبة. الآن كل متجر أرسل طلبه إلا المحظور، بحالته إن لم يكن معتمداً، ورفض الخادم يُكتب مكان «…».
 * وبرابطه (5 نوفمبر 2026): متجران بالاسم نفسه كانا سطرين متطابقين لا يُعرف أيّهما يُختار.
 *
 * والنسب الخاصة صفحات من الخادم ببحث باسم المتجر (3 نوفمبر 2026): كانت القواعد كلها — 534 —
 * تُجلب وتُصفّى هنا بلا «المزيد» ولا «السابق». العامة تأتي وحدها معها.
 */
export default function AdminCommissionsPage() {
  const t = useT();
  const locale = useLocale();
  const [ruleSearch, setRuleSearch] = useState('');
  const rq = new URLSearchParams(ruleSearch.trim() ? { search: ruleSearch.trim() } : {});
  const list = useAdminList<Rule, { global: Rule | null; counts: { vendor: number } }>(`/admin/finance/commissions?${rq}`, (r) => r.id);
  const { data, error, forbidden, reload } = list;
  const act = useAction();
  const ask = useConfirm();
  const [scope, setScope] = useState<'global' | 'vendor'>('global');
  const [target, setTarget] = useState('');
  // اسم المختار يبقى ظاهراً ولو خرج من نتائج بحث لاحق
  const [targetName, setTargetName] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const vq = new URLSearchParams({ limit: String(PICK), ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}) });
  const { data: vendors, error: vendorsError } = useAdminData<{ items: VendorItem[]; total: number }>(
    scope === 'vendor' ? `/admin/finance/commissions/vendors?${vq}` : null,
  );
  const [rate, setRate] = useState('');
  const formRef = useRef<HTMLElement | null>(null);
  const rateRef = useRef<HTMLInputElement | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const global = data.global;
  // كل النسب الخاصة لا نتيجة البحث: «لا نسبة خاصة» غير «لا نسبة لهذا الاسم»
  const hasCustom = data.counts.vendor > 0;
  const shownCustom = list.items;

  // «غيّر» و«نسبة لمتجر» تملأ النموذج وتنقل التركيز إليه
  const startRule = (s: Rule['scope'], vendorId = '', vendorName = '') => {
    setScope(s);
    setTarget(vendorId);
    setTargetName(vendorName);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rateRef.current?.focus({ preventScroll: true });
  };

  const save = () =>
    act.run(async () => {
      const bps = Math.round(Number(rate) * 100);
      await api('/admin/finance/commissions', {
        method: 'POST',
        body: { scope, rateBps: bps, ...(scope === 'vendor' ? { vendorId: target } : {}) },
      });
      setRate('');
      reload();
    }, t('سُجّلت النسبة الجديدة وأُنهيت السابقة. الطلبات السابقة لم تتغيّر.', 'The new rate is recorded and the previous one has ended. Past orders are unchanged.'));

  const endCustom = async (r: Rule) => {
    if (!r.vendorId) return;
    const back = global ? `، ويعود المتجر إلى النسبة العامة ${pct(global.rateBps)}` : '';
    const backEn = global ? `, and the shop returns to the general rate of ${pct(global.rateBps, locale)}` : '';
    const sure = await ask({
      title: t(`تلغي نسبة «${r.vendor?.nameAr ?? 'المتجر'}» الخاصة؟`, `Cancel the custom rate for “${r.vendor?.nameAr ?? 'the shop'}”?`),
      body: t(`من الآن${back}. الطلبات السابقة لا تتأثر.`, `Effective now${backEn}. Past orders are not affected.`),
      confirmLabel: t('ألغِ النسبة الخاصة', 'Cancel custom rate'),
      danger: true,
    });
    if (!sure) return;
    void act.run(async () => {
      await api(`/admin/finance/commissions/vendor/${r.vendorId}`, { method: 'DELETE' });
      reload();
    }, t('أُلغيت النسبة الخاصة — المتجر على النسبة العامة من الآن.', 'Custom rate canceled — the shop is on the general rate from now on.'));
  };

  const validRate = rate !== '' && Number(rate) >= 0 && Number(rate) <= 50;

  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('العمولة', 'Commission')}
        hint={t(
          'نسبة على كل منتج يُباع بغضّ النظر عن فئته أو سعره: نسبة المتجر إن خُصّصت، وإلا النسبة العامة.',
          'A rate on every product sold, whatever its category or price: the shop’s rate if it has one, otherwise the general rate.',
        )}
      />
      <div className="alert alert--warning ac2-callout">
        <Icon name="alert" size={16} />
        <span>
          {t(
            'تغيير النسبة لا يؤثّر على أي طلب سابق — كل طلب يحمل نسبته الملقوطة لحظة الشراء. القواعد لا تُحذف: تُنهى صلاحيتها بتاريخ حين تحلّ محلّها قاعدة جديدة.',
            'Changing the rate does not affect any past order — each order keeps the rate captured at the moment of purchase. Rules are never deleted: they get an end date when a new rule replaces them.',
          )}
        </span>
      </div>
      <Feedback error={act.error} notice={act.notice} />

      <section className="card card--flush" aria-label={t('النسبة العامة', 'General rate')}>
        <header className="card__head">
          <h2 className="ac2-title">{t('النسبة العامة', 'General rate')}</h2>
          <span className="ac2-hint">{t('على كل متجر لم تُخصَّص له نسبة', 'Applies to every shop without a custom rate')}</span>
          <span className="ac2-end">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => startRule('global')}>
              {t('غيّر النسبة العامة', 'Change general rate')}
            </button>
          </span>
        </header>
        {global ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('النطاق', 'Scope')}</th>
                  <th scope="col">{t('النسبة', 'Rate')}</th>
                  <th scope="col">{t('السريان', 'In effect')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{t('كل المنصّة', 'Whole platform')}</strong>
                  </td>
                  <td className="num ac2-rate" data-label={t('النسبة', 'Rate')}>
                    {pct(global.rateBps, locale)}
                  </td>
                  <td className="ac2-muted-cell" data-label={t('السريان', 'In effect')}>
                    {when(global.effectiveFrom, locale)} — {global.effectiveTo ? when(global.effectiveTo, locale) : t('مفتوحة', 'Open-ended')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ac2-section-empty">{t('لا نسبة عامة بعد — حدّدها من النموذج أدناه.', 'No general rate yet — set it in the form below.')}</p>
        )}
      </section>

      <section className="card card--flush" aria-label={t('نسب خاصة بمتاجر', 'Custom shop rates')}>
        <header className="card__head">
          <h2 className="ac2-title">{t('نسب خاصة بمتاجر', 'Custom shop rates')}</h2>
          <span className="ac2-hint">{t('تتجاوز النسبة العامة للمتجر وحده', 'Override the general rate for that shop only')}</span>
          <span className="ac2-end ac2-inline">
            {hasCustom ? (
              <SearchBox
                value={ruleSearch}
                onChange={setRuleSearch}
                placeholder={t('صفِّ باسم المتجر', 'Filter by shop name')}
                label={t('صفِّ النسب الخاصة باسم المتجر', 'Filter custom rates by shop name')}
                className="ac2-search"
              />
            ) : null}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => startRule('vendor')}>
              <Icon name="plus" size={14} />
              {t('نسبة لمتجر', 'Rate for a shop')}
            </button>
          </span>
        </header>
        {!hasCustom ? (
          <p className="ac2-section-empty">{t('كل المتاجر على النسبة العامة.', 'All shops are on the general rate.')}</p>
        ) : shownCustom.length === 0 ? (
          <p className="ac2-section-empty">
            {t('لا نسبة خاصة لمتجر بهذا الاسم — ابحث عنه في «نسبة جديدة» لتعطيه واحدة.', 'No custom rate for a shop with this name — search for it in “New rate” to give it one.')}
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('المتجر', 'Shop')}</th>
                    <th scope="col">{t('النسبة', 'Rate')}</th>
                    <th scope="col">{t('السريان', 'In effect')}</th>
                    <th scope="col" className="end">
                      <span className="visually-hidden">{t('إجراءات', 'Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shownCustom.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.vendor?.nameAr ?? '—'}</strong>
                      </td>
                      <td className="num ac2-rate" data-label={t('النسبة', 'Rate')}>
                        {pct(r.rateBps, locale)}
                      </td>
                      <td className="ac2-muted-cell" data-label={t('السريان', 'In effect')}>
                        {when(r.effectiveFrom, locale)} — {r.effectiveTo ? when(r.effectiveTo, locale) : t('مفتوحة', 'Open-ended')}
                      </td>
                      <td className="end" data-label="">
                        <span className="ac2-inline">
                          <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => startRule('vendor', r.vendorId ?? '', r.vendor?.nameAr ?? '')}>
                            {t('غيّر', 'Change')}
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={act.busy} onClick={() => void endCustom(r)}>
                            {t('أعده إلى العامة', 'Back to general rate')}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MoreButton list={list} />
          </>
        )}
      </section>

      <section ref={formRef} className="card" aria-label={t('نسبة جديدة', 'New rate')}>
        <h2 className="ac2-title">{t('نسبة جديدة', 'New rate')}</h2>
        <p className="ac2-hint">{t('تسري من لحظة الاعتماد وتُنهي القاعدة السارية في نطاقها.', 'Takes effect the moment it is approved and ends the current rule in its scope.')}</p>
        <div className="ac2-form">
          <label className="field">
            <span className="field__label">{t('النطاق', 'Scope')}</span>
            <select className="field__control" value={scope} onChange={(e) => (setScope(e.target.value as typeof scope), setTarget(''), setTargetName(''))}>
              <option value="global">{t('عامة — كل المنصّة', 'General — whole platform')}</option>
              <option value="vendor">{t('خاصة بمتجر', 'Custom for a shop')}</option>
            </select>
          </label>
          {scope === 'vendor' ? (
            <div className="field ac2-form__wide">
              <span className="field__label" id="commission-vendor">
                {t('المتجر', 'Shop')}
              </span>
              <div className="ac2-pick">
                <SearchBox
                  value={vendorSearch}
                  onChange={setVendorSearch}
                  placeholder={t('ابحث باسم المتجر أو رابطه أو بريد صاحبه', 'Search by shop name, link or owner email')}
                  label={t('ابحث عن متجر', 'Search for a shop')}
                  className="ac2-search"
                />
                <select
                  className="field__control"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setTargetName(e.target.selectedOptions[0]?.text ?? '');
                  }}
                  aria-labelledby="commission-vendor"
                >
                  <option value="">
                    {!vendors
                      ? (vendorsError ?? '…')
                      : vendors.total > vendors.items.length
                        ? t(`اختر من أول ${vendors.items.length} من ${vendors.total} — أو ضيّق بالبحث`, `Pick from the first ${vendors.items.length} of ${vendors.total} — or search to narrow down`)
                        : vendors.total === 0
                          ? t('لا متجر بهذا البحث', 'No shop matches this search')
                          : t('اختر', 'Choose')}
                  </option>
                  {target && !(vendors?.items ?? []).some((v) => v.id === target) ? <option value={target}>{targetName || target.slice(0, 8)}</option> : null}
                  {(vendors?.items ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {`${v.status === 'approved' ? v.nameAr : `${v.nameAr} — ${(locale === 'en' ? VENDOR_STATUS_EN : VENDOR_STATUS)[v.status] ?? v.status}`} · ${v.slug}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <label className="field">
            <span className="field__label">{t('النسبة %', 'Rate %')}</span>
            <ClearableInput ref={rateRef} className="field__control num" inputMode="decimal" dir="ltr" placeholder="3" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <div className="ac2-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || !validRate || (scope === 'vendor' && !target)}
              onClick={async () => {
                const sure = await ask({
                  title: t(
                    `تعتمد ${rate}% ${scope === 'global' ? 'نسبةً عامة' : 'لهذا المتجر'} من الآن؟`,
                    `Approve ${rate}% ${scope === 'global' ? 'as the general rate' : 'for this shop'} from now on?`,
                  ),
                  body: t('تنتهي النسبة السابقة، والطلبات السابقة لا تتأثر.', 'The previous rate ends, and past orders are not affected.'),
                  confirmLabel: t('اعتمد النسبة', 'Approve rate'),
                });
                if (sure) void save();
              }}
            >
              {t('اعتماد من الآن', 'Approve from now')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
