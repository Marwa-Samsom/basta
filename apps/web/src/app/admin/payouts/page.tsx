'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Card } from '@/components/ui';
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
    <div className="stack stack--loose">
      <AdminHeader title="طلبات السحب" hint="تحتاج صلاحية payouts.approve — هذه الصفحة تحرّك مالاً." />
      <Feedback error={act.error} notice={act.notice} />
      <Tabs value={status} onChange={setStatus} options={Object.entries(STATUS).map(([key, label]) => ({ key, label }))} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.length === 0 ? (
        <Card>
          <Empty>لا طلبات هنا.</Empty>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>المتجر</th>
                <th>المبلغ</th>
                <th>الحساب</th>
                <th>الطلب</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>{p.vendor}</td>
                  <td className="money">{money(p.amountMinorUnits, p.currency)}</td>
                  <td className="small">
                    {p.bank.bankName} · {p.bank.holderName} · ••{p.bank.ibanLast4}
                  </td>
                  <td className="small">{when(p.requestedAt)}</td>
                  <td>
                    <span className={`badge ${TONE[p.status] ?? ''}`}>{STATUS[p.status] ?? p.status}</span>
                    {p.transferReference ? <div className="small num">{p.transferReference}</div> : null}
                    {p.rejectReason ? <div className="small muted">«{p.rejectReason}»</div> : null}
                  </td>
                  <td>
                    <div className="row">
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
                          موافقة
                        </button>
                      ) : null}
                      {p.status === 'approved' ? (
                        <>
                          <input className="field__control" placeholder="مرجع التحويل" dir="ltr" value={refs[p.id] ?? ''} onChange={(e) => setRefs({ ...refs, [p.id]: e.target.value })} aria-label="مرجع التحويل" />
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
