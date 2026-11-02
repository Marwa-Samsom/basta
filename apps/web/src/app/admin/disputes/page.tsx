'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { TextArea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData, useAdminList } from '@/lib/admin';
import { DISPUTES, counted } from '@/lib/arabic-count';
import { localized } from '@/lib/i18n';
import { DISPUTE_REASONS, DISPUTE_REASONS_EN, DISPUTE_STATUS, DISPUTE_STATUS_EN, ROLE_LABEL, ROLE_LABEL_EN, labelOf, when } from '@/lib/orders';

interface Row {
  id: string;
  reasonCode: string;
  status: string;
  createdAt: string;
  subOrder: { id: string; subOrderNumber: string; vendor: { nameAr: string }; order: { orderNumber: string } };
  _count: { messages: number };
}

interface Thread {
  id: string;
  status: string;
  reasonCode: string;
  resolution: string | null;
  messages: { id: string; senderRole: string; body: string; createdAt: string }[];
  subOrder: { id: string; subOrderNumber: string; status: string; vendor: { nameAr: string }; order: { orderNumber: string } };
}

/** المشتري في طرف، والمتجر في الطرف المقابل، والإدارة في الوسط — كما في التصميم */
const SIDE: Record<string, string> = { customer: 'start', vendor_owner: 'end', vendor_staff: 'end', admin: 'center' };

/**
 * AD-14 — النزاعات. المصعَّد أولاً، ومال الطلب مجمَّد حتى الحسم (ADR-007).
 * الحسم للمشتري يكتمل بإجراء الطلب نفسه (إلغاء أو استلام مرتجع من صفحة
 * الطلبات) — القرار هنا يوثّق الحكم ويفكّ التجميد. البحث برقم الطلب أو المتجر أو المشتري،
 * و«المزيد» لما بعد الخمسين.
 */
export default function AdminDisputesPage() {
  const t = useT();
  const locale = useLocale();
  const disputeStatus = localized(locale, DISPUTE_STATUS, DISPUTE_STATUS_EN);
  const disputeReasons = localized(locale, DISPUTE_REASONS, DISPUTE_REASONS_EN);
  const [status, setStatus] = useState('escalated');
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const query = new URLSearchParams({ status, sort, ...(search.trim() ? { search: search.trim() } : {}) });
  const list = useAdminList<Row>(`/admin/disputes?${query}`, (d) => d.id);
  const { data, error, forbidden, reload } = list;
  const live = status === 'open' || status === 'escalated';
  // النزاع المختار، وإلا أوّل القائمة: الحاجة أن يُقرأ لا أن يُبحث عنه
  const activeId = list.items.find((d) => d.id === openId)?.id ?? list.items[0]?.id ?? null;

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('النزاعات', 'Disputes')}
        count={data ? t(counted(data.total, DISPUTES), `${data.total} ${data.total === 1 ? 'dispute' : 'disputes'}`) : undefined}
        hint={t('الرصيد مجمَّد ما دام النزاع مفتوحاً.', 'The balance stays frozen while the dispute is open.')}
      />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={(s) => {
            setStatus(s);
            setOpenId(null);
          }}
          label={t('حالة النزاع', 'Dispute status')}
          options={['escalated', 'open', 'resolved_customer', 'resolved_vendor', 'withdrawn'].map((k) => ({ key: k, label: disputeStatus[k]! }))}
        />
        <div className="toolbar__end">
          <SearchBox value={search} onChange={setSearch} placeholder={t('رقم الطلب أو المتجر أو المشتري', 'Order number, shop or buyer')} label={t('بحث في النزاعات', 'Search disputes')} />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty
            icon="search"
            title={t('لا نزاعات بهذا البحث', 'No disputes match this search')}
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                {t('أزل التصفية', 'Clear filter')}
              </button>
            }
          >
            {t('جرّب رقماً آخر أو حالة أخرى من الرقائق أعلاه.', 'Try another number or another status from the chips above.')}
          </Empty>
        ) : (
          <Empty icon={live ? 'check-circle' : 'scale'} tone={live ? 'success' : undefined} title={t('لا نزاعات هنا', 'No disputes here')}>
            {live ? t('لا نزاع ينتظر قراراً الآن.', 'No dispute is waiting for a decision right now.') : t('جرّب حالة أخرى من الرقائق أعلاه.', 'Try another status from the chips above.')}
          </Empty>
        )
      ) : (
        <div className="ao-split">
          <nav className="ao-dlist" aria-label={t('قائمة النزاعات', 'Dispute list')}>
            <div className="ao-dlist__head">
              <h2 className="ao-card-title">{disputeStatus[status] ?? status}</h2>
              <span className="ao-dlist__count num">{data.total}</span>
            </div>
            <ul>
              {list.items.map((d) => (
                <li key={d.id}>
                  <button type="button" className="ao-ditem" aria-current={d.id === activeId ? 'true' : undefined} onClick={() => setOpenId(d.id)}>
                    <span className="ao-ditem__no num">{d.subOrder.subOrderNumber}</span>
                    <span className="ao-ditem__reason">{disputeReasons[d.reasonCode] ?? d.reasonCode}</span>
                    <span className="ao-ditem__meta">
                      {live ? <span className="badge badge--danger">{t('رصيد مجمَّد', 'Balance frozen')}</span> : null}
                      <span>{d.subOrder.vendor.nameAr}</span>
                      <span>
                        <span className="num">{d._count.messages}</span> {t('رسالة', d._count.messages === 1 ? 'message' : 'messages')}
                      </span>
                    </span>
                    <span className="ao-ditem__when">{when(d.createdAt, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <MoreButton list={list} />
          </nav>
          {activeId ? <DisputeDetail key={activeId} id={activeId} onChange={reload} /> : null}
        </div>
      )}
    </div>
  );
}

function DisputeDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const t = useT();
  const locale = useLocale();
  const disputeStatus = localized(locale, DISPUTE_STATUS, DISPUTE_STATUS_EN);
  const disputeReasons = localized(locale, DISPUTE_REASONS, DISPUTE_REASONS_EN);
  const roleLabel = localized(locale, ROLE_LABEL, ROLE_LABEL_EN);
  const { data, error, reload } = useAdminData<Thread>(`/admin/disputes/${id}`);
  const act = useAction();
  const [body, setBody] = useState('');
  const [resolution, setResolution] = useState('');
  const [outcome, setOutcome] = useState<'customer' | 'vendor' | null>(null);
  if (!data) return <Loading error={error} inline />;
  const open = data.status === 'open' || data.status === 'escalated';

  const resolve = (to: 'customer' | 'vendor') =>
    act.run(async () => {
      await api(`/admin/disputes/${id}/resolve`, { method: 'POST', body: { outcome: to, resolution } });
      reload();
      onChange();
    }, t('حُسم النزاع وفُكّ تجميد الرصيد.', 'Dispute resolved and the balance unfrozen.'));

  return (
    <div className="ao-dpane">
      <Feedback error={act.error} notice={act.notice} />
      <section className="card ao-dsum">
        <span className="ao-dsum__no num">{data.subOrder.subOrderNumber}</span>
        <h2 className="ao-dsum__reason">{disputeReasons[data.reasonCode] ?? data.reasonCode}</h2>
        <span className="ao-dsum__who">
          {t('ضدّ', 'Against')} {data.subOrder.vendor.nameAr} · {t('الطلب', 'Order')} <span className="num">{data.subOrder.order.orderNumber}</span>
        </span>
        <div className="ao-facts">
          <span className="ao-fact">
            <span className="ao-fact__k">{t('حالة الطلب الفرعي', 'Shop order status')}</span>
            <span className="ao-fact__v">{labelOf(data.subOrder.status, locale)}</span>
          </span>
          <span className="ao-fact">
            <span className="ao-fact__k">{t('حالة النزاع', 'Dispute status')}</span>
            <span className="ao-fact__v">{disputeStatus[data.status] ?? data.status}</span>
          </span>
          <span className="ao-fact">
            <span className="ao-fact__k">{t('الرصيد', 'Balance')}</span>
            <span className="ao-fact__v">{open ? t('مجمَّد حتى الحسم', 'Frozen until resolved') : t('فُكّ تجميده', 'Unfrozen')}</span>
          </span>
        </div>
      </section>

      <div className="ao-dgrid">
        <section className="card card--flush">
          <header className="card__head">
            <h2>{t('مجرى النزاع', 'Dispute thread')}</h2>
          </header>
          <ol className="ao-thread">
            {data.messages.length === 0 ? <li className="muted small">{t('لا رسائل بعد.', 'No messages yet.')}</li> : null}
            {data.messages.map((m) => (
              <li key={m.id} className="ao-msg" data-side={SIDE[m.senderRole] ?? 'start'}>
                <span className="ao-msg__meta">
                  <span className="ao-msg__role" data-role={SIDE[m.senderRole] ?? 'start'}>
                    {roleLabel[m.senderRole] ?? m.senderRole}
                  </span>
                  <span className="ao-msg__when">{when(m.createdAt, locale)}</span>
                </span>
                <p className="ao-msg__body">{m.body}</p>
              </li>
            ))}
          </ol>
          {open ? (
            <div className="card__foot ao-reply">
              <TextArea label={t('رسالة للطرفين', 'Message to both parties')} value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={act.busy || !body.trim()}
                onClick={() =>
                  void act.run(async () => {
                    await api(`/admin/disputes/${id}/messages`, { method: 'POST', body: { body } });
                    setBody('');
                    reload();
                    // وعدّاد رسائله في القائمة — كان يبقى «2 رسالة» حتى تحديث الصفحة (ADM-066، 31 أكتوبر 2026)
                    onChange();
                  })
                }
              >
                <Icon name="send" size={14} />
                {t('إرسال', 'Send')}
              </button>
            </div>
          ) : null}
        </section>

        <section className="card ao-decision">
          <h2 className="ao-card-title">{t('القرار', 'Decision')}</h2>
          {data.resolution ? (
            <div className="ao-note" data-tone="info">
              <Icon name="scale" size={16} />
              <span>{t(`القرار: «${data.resolution}»`, `Decision: “${data.resolution}”`)}</span>
            </div>
          ) : null}
          {open ? (
            <>
              <fieldset className="ao-options">
                <legend className="visually-hidden">{t('لصالح من', 'In whose favor')}</legend>
                <label className="ao-option">
                  <input type="radio" name={`outcome-${id}`} checked={outcome === 'customer'} onChange={() => setOutcome('customer')} />
                  <span className="ao-option__text">
                    <span className="ao-option__label">{t('لصالح المشتري', 'For the buyer')}</span>
                    {/* الردّ آلي مع القرار (refundForDispute) — كان التلميح يدعو لردّ يدوي ثانٍ (J-06، ADM-070) */}
                    <span className="ao-option__hint">
                      {t(
                        'يُردّ للمشتري ما بقي من مبلغ هذا المتجر تلقائياً مع القرار، بقيوده في الدفتر — لا إلغاء ولا إرجاع يدوي بعده.',
                        'What remains of this shop’s amount is refunded to the buyer automatically with the decision, with its ledger entries — no manual cancel or return afterwards.',
                      )}
                    </span>
                  </span>
                </label>
                <label className="ao-option">
                  <input type="radio" name={`outcome-${id}`} checked={outcome === 'vendor'} onChange={() => setOutcome('vendor')} />
                  <span className="ao-option__text">
                    <span className="ao-option__label">{t('لصالح المتجر', 'For the shop')}</span>
                    <span className="ao-option__hint">{t('يُفكّ تجميد الرصيد للمتجر.', 'The balance is unfrozen for the shop.')}</span>
                  </span>
                </label>
              </fieldset>
              <TextArea
                label={t('سبب القرار — يظهر للطرفين', 'Reason for the decision — shown to both parties')}
                placeholder={t('اكتب سبباً واضحاً يفهمه الطرفان.', 'Write a clear reason both parties can understand.')}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={3}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={act.busy || !outcome || resolution.trim().length < 5}
                onClick={() => outcome && void resolve(outcome)}
              >
                {t('أصدر القرار', 'Issue decision')}
              </button>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
