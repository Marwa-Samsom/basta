'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, ReasonButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { TONE, useAction, useAdminList } from '@/lib/admin';
import { money, when } from '@/lib/orders';
import { ClearableInput } from '@/components/ui';
import { useLocale, useT } from '@/components/locale';
import { localized } from '@/lib/i18n';

interface Payout {
  id: string;
  vendor: string;
  currency: string;
  amountMinorUnits: string;
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  transferReference: string | null;
  rejectReason: string | null;
  bank: { bankName: string; holderName: string; ibanLast4: string };
}

const STATUS: Record<string, string> = { requested: 'بانتظار الموافقة', approved: 'موافَق — للتحويل', paid: 'حُوِّل', rejected: 'مرفوض' };
const STATUS_EN: Record<string, string> = { requested: 'Awaiting approval', approved: 'Approved — to transfer', paid: 'Transferred', rejected: 'Rejected' };

const EMPTY: Record<string, string> = {
  requested: 'تظهر الطلبات هنا عندما يطلب تاجر سحب رصيده المتاح.',
  approved: 'لا تحويلات موافَقاً عليها تنتظر التنفيذ.',
  paid: 'لا تحويلات مسجَّلة بعد.',
  rejected: 'لا طلبات مرفوضة.',
};

const EMPTY_EN: Record<string, string> = {
  requested: 'Requests appear here when a seller asks to withdraw their available balance.',
  approved: 'No approved transfers are waiting to be made.',
  paid: 'No transfers recorded yet.',
  rejected: 'No rejected requests.',
};

/**
 * AD-13 — السحوبات. المبلغ خُصم من متاح البائع لحظة الطلب؛ الموافقة ثم
 * تسجيل التحويل بمرجعه، والرفض قيد معاكس يعيده فوراً. رقم الحساب كاملاً
 * لا يظهر في القائمة — آخر أربعة أرقام تكفي للتعرّف، والكامل في ملف البائع.
 *
 * بحث و«المزيد» (20 أكتوبر 2026): كانت تعرض أحدث مئتين بلا بحث، فطلب «غزة» بين مئات طلبات
 * متاجر الاختبار لا يُوجد (J-11). البحث باسم المتجر أو رابطه أو مرجع التحويل.
 */
export default function AdminPayoutsPage() {
  const t = useT();
  const locale = useLocale();
  const statusLabel = localized(locale, STATUS, STATUS_EN);
  const [status, setStatus] = useState('requested');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const query = new URLSearchParams({ status, sort, ...(search.trim() ? { search: search.trim() } : {}) });
  const list = useAdminList<Payout>(`/admin/finance/payouts?${query}`, (p) => p.id);
  const { data, error, forbidden, reload } = list;
  const act = useAction();
  const [refs, setRefs] = useState<Record<string, string>>({});

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('طلبات التحويل', 'Payout requests')}
        count={data ? t(`${data.total} طلب`, `${data.total} ${data.total === 1 ? 'request' : 'requests'}`) : undefined}
        hint={t('تحتاج صلاحية payouts.approve — هذه الصفحة تحرّك مالاً.', 'Requires the payouts.approve permission — this page moves money.')}
      >
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              await api('/admin/finance/release-due', { method: 'POST' });
              reload();
            }, t('شُغّل تحرير الأرصدة المستحقة (الشروط نفسها: انقضاء التعليق بلا نزاع ولا إرجاع).', 'Release of due balances has run (same conditions: hold period over with no dispute or return).'))
          }
        >
          <Icon name="refresh" size={14} />
          {t('تحرير المستحق الآن', 'Release due now')}
        </button>
      </AdminHeader>
      <Feedback error={act.error} notice={act.notice} />
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} label={t('حالة الطلب', 'Request status')} options={Object.entries(statusLabel).map(([key, label]) => ({ key, label }))} />
        <div className="toolbar__end">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t('اسم المتجر أو رابطه أو مرجع التحويل', 'Shop name, link, or transfer reference')}
            label={t('بحث في طلبات التحويل', 'Search payout requests')}
          />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty
            icon="search"
            title={t('لا طلبات بهذا البحث', 'No requests match this search')}
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                {t('أزل التصفية', 'Clear filters')}
              </button>
            }
          >
            {t('جرّب اسماً آخر أو حالة أخرى من الرقائق أعلاه.', 'Try another name or another status from the chips above.')}
          </Empty>
        ) : (
          <Empty icon="wallet" title={t('لا طلبات تحويل هنا', 'No payout requests here')}>
            {localized(locale, EMPTY, EMPTY_EN)[status]}
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>{t('المتجر', 'Shop')}</th>
                <th className="end">{t('المبلغ', 'Amount')}</th>
                <th>{t('الحساب', 'Account')}</th>
                <th>{t('الطلب', 'Requested')}</th>
                <th>{t('الحالة', 'Status')}</th>
                <th className="end">
                  <span className="visually-hidden">{t('الإجراء', 'Action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="ao-shop">
                      <span className="ao-tile" aria-hidden>
                        <Icon name="store" size={15} />
                      </span>
                      <span className="ao-shop__text">
                        <span className="ao-shop__name">{p.vendor}</span>
                        <span className="ao-shop__sub">
                          {t('عملة التسوية', 'Settlement currency')} <span className="num">{p.currency}</span>
                        </span>
                      </span>
                    </span>
                  </td>
                  <td data-label={t('المبلغ', 'Amount')} className="end">
                    <span className="money num ao-amount">{money(p.amountMinorUnits, p.currency, locale)}</span>
                  </td>
                  <td data-label={t('الحساب', 'Account')}>
                    <span className="ao-stack">
                      <span>
                        {p.bank.bankName} · <span className="num">••{p.bank.ibanLast4}</span>
                      </span>
                      <span className="ao-stack__sub">{p.bank.holderName}</span>
                    </span>
                  </td>
                  <td data-label={t('الطلب', 'Requested')} className="ao-date">
                    {when(p.requestedAt, locale)}
                  </td>
                  <td data-label={t('الحالة', 'Status')}>
                    <span className="ao-stack">
                      <span className={`badge ${TONE[p.status] ?? ''}`}>{statusLabel[p.status] ?? p.status}</span>
                      {p.transferReference ? <span className="ao-stack__sub num">{p.transferReference}</span> : null}
                      {p.rejectReason ? <span className="ao-stack__sub">{t('«', '“')}{p.rejectReason}{t('»', '”')}</span> : null}
                    </span>
                  </td>
                  <td data-label="" className="end">
                    <div className="ao-actions">
                      {p.status === 'requested' ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={act.busy}
                          onClick={() =>
                            void act.run(async () => {
                              await api(`/admin/finance/payouts/${p.id}/approve`, { method: 'POST' });
                              reload();
                            }, t('وافقت. سجّل التحويل بعد تنفيذه من البنك.', 'Approved. Record the transfer once the bank has made it.'))
                          }
                        >
                          <Icon name="check" size={14} />
                          {t('موافقة', 'Approve')}
                        </button>
                      ) : null}
                      {p.status === 'approved' ? (
                        <>
                          <ClearableInput
                            className="field__control ao-ref"
                            placeholder={t('مرجع التحويل', 'Transfer reference')}
                            dir="ltr"
                            value={refs[p.id] ?? ''}
                            onChange={(e) => setRefs({ ...refs, [p.id]: e.target.value })}
                            aria-label={t('مرجع التحويل', 'Transfer reference')}
                          />
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={act.busy || (refs[p.id]?.trim().length ?? 0) < 3}
                            onClick={() =>
                              void act.run(async () => {
                                await api(`/admin/finance/payouts/${p.id}/paid`, { method: 'POST', body: { transferReference: refs[p.id] } });
                                reload();
                              }, t('سُجّل التحويل وأُبلغ البائع.', 'Transfer recorded and the seller notified.'))
                            }
                          >
                            {t('تسجيل التحويل', 'Record transfer')}
                          </button>
                        </>
                      ) : null}
                      {p.status === 'requested' || p.status === 'approved' ? (
                        <ReasonButton
                          label={t('رفض', 'Reject')}
                          hint={t('يعود المبلغ إلى متاح البائع فوراً بقيد معاكس، ويصله السبب.', "The amount returns to the seller's available balance at once by a reversing entry, and they receive the reason.")}
                          disabled={act.busy}
                          onSubmit={(r) =>
                            act.run(async () => {
                              await api(`/admin/finance/payouts/${p.id}/reject`, { method: 'POST', body: { reason: r } });
                              reload();
                            }, t('رُفض وعاد المبلغ إلى رصيد البائع.', "Rejected; the amount is back in the seller's balance."))
                          }
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton list={list} />
    </div>
  );
}
