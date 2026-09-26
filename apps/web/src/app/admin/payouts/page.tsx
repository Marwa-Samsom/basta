'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { TONE, useAction, useAdminData } from '@/lib/admin';
import { money, when } from '@/lib/orders';

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

const EMPTY: Record<string, string> = {
  requested: 'تظهر الطلبات هنا عندما يطلب تاجر سحب رصيده المتاح.',
  approved: 'لا تحويلات موافَقاً عليها تنتظر التنفيذ.',
  paid: 'لا تحويلات مسجَّلة بعد.',
  rejected: 'لا طلبات مرفوضة.',
};

/**
 * AD-13 — السحوبات. المبلغ خُصم من متاح البائع لحظة الطلب؛ الموافقة ثم
 * تسجيل التحويل بمرجعه، والرفض قيد معاكس يعيده فوراً. رقم الحساب كاملاً
 * لا يظهر في القائمة — آخر أربعة أرقام تكفي للتعرّف، والكامل في ملف البائع.
 */
export default function AdminPayoutsPage() {
  const [status, setStatus] = useState('requested');
  const { data, error, forbidden, reload } = useAdminData<Payout[]>(`/admin/finance/payouts?status=${status}`);
  const act = useAction();
  const [refs, setRefs] = useState<Record<string, string>>({});

  return (
    <div className="ao-page">
      <AdminHeader title="طلبات التحويل" count={data ? `${data.length} طلب` : undefined} hint="تحتاج صلاحية payouts.approve — هذه الصفحة تحرّك مالاً.">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              await api('/admin/finance/release-due', { method: 'POST' });
              reload();
            }, 'شُغّل تحرير الأرصدة المستحقة (الشروط نفسها: انقضاء التعليق بلا نزاع ولا إرجاع).')
          }
        >
          <Icon name="refresh" size={14} />
          تحرير المستحق الآن
        </button>
      </AdminHeader>
      <Feedback error={act.error} notice={act.notice} />
      <Tabs value={status} onChange={setStatus} label="حالة الطلب" options={Object.entries(STATUS).map(([key, label]) => ({ key, label }))} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.length === 0 ? (
        <Empty icon="wallet" title="لا طلبات تحويل هنا">
          {EMPTY[status]}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>المتجر</th>
                <th className="end">المبلغ</th>
                <th>الحساب</th>
                <th>الطلب</th>
                <th>الحالة</th>
                <th className="end">
                  <span className="visually-hidden">الإجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="ao-shop">
                      <span className="ao-tile" aria-hidden>
                        <Icon name="store" size={15} />
                      </span>
                      <span className="ao-shop__text">
                        <span className="ao-shop__name">{p.vendor}</span>
                        <span className="ao-shop__sub">
                          عملة التسوية <span className="num">{p.currency}</span>
                        </span>
                      </span>
                    </span>
                  </td>
                  <td data-label="المبلغ" className="end">
                    <span className="money num ao-amount">{money(p.amountMinorUnits, p.currency)}</span>
                  </td>
                  <td data-label="الحساب">
                    <span className="ao-stack">
                      <span>
                        {p.bank.bankName} · <span className="num">••{p.bank.ibanLast4}</span>
                      </span>
                      <span className="ao-stack__sub">{p.bank.holderName}</span>
                    </span>
                  </td>
                  <td data-label="الطلب" className="ao-date">
                    {when(p.requestedAt)}
                  </td>
                  <td data-label="الحالة">
                    <span className="ao-stack">
                      <span className={`badge ${TONE[p.status] ?? ''}`}>{STATUS[p.status] ?? p.status}</span>
                      {p.transferReference ? <span className="ao-stack__sub num">{p.transferReference}</span> : null}
                      {p.rejectReason ? <span className="ao-stack__sub">«{p.rejectReason}»</span> : null}
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
                            }, 'وافقت. سجّل التحويل بعد تنفيذه من البنك.')
                          }
                        >
                          <Icon name="check" size={14} />
                          موافقة
                        </button>
                      ) : null}
                      {p.status === 'approved' ? (
                        <>
                          <input
                            className="field__control ao-ref"
                            placeholder="مرجع التحويل"
                            dir="ltr"
                            value={refs[p.id] ?? ''}
                            onChange={(e) => setRefs({ ...refs, [p.id]: e.target.value })}
                            aria-label="مرجع التحويل"
                          />
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={act.busy || (refs[p.id]?.trim().length ?? 0) < 3}
                            onClick={() =>
                              void act.run(async () => {
                                await api(`/admin/finance/payouts/${p.id}/paid`, { method: 'POST', body: { transferReference: refs[p.id] } });
                                reload();
                              }, 'سُجّل التحويل وأُبلغ البائع.')
                            }
                          >
                            تسجيل التحويل
                          </button>
                        </>
                      ) : null}
                      {p.status === 'requested' || p.status === 'approved' ? (
                        <ReasonButton
                          label="رفض"
                          hint="يعود المبلغ إلى متاح البائع فوراً بقيد معاكس، ويصله السبب."
                          disabled={act.busy}
                          onSubmit={(r) =>
                            act.run(async () => {
                              await api(`/admin/finance/payouts/${p.id}/reject`, { method: 'POST', body: { reason: r } });
                              reload();
                            }, 'رُفض وعاد المبلغ إلى رصيد البائع.')
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
    </div>
  );
}
