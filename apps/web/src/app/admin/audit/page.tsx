'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Empty, Loading } from '@/components/admin';
import { Card } from '@/components/ui';
import { useAdminData } from '@/lib/admin';
import { ROLE_LABEL, when } from '@/lib/orders';

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  ip: string | null;
  createdAt: string;
  actor: { email: string | null; fullName: string | null } | null;
}

/**
 * AD-24 — سجل التدقيق. للقراءة وحدها: لا زرّ تعديل ولا حذف في أي مكان،
 * والقاعدة نفسها ترفض ذلك (ADR-005). التفاصيل: القيمة قبل وبعد.
 */
function AuditInner() {
  const params = useSearchParams();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const entityId = params.get('entityId') ?? '';
  const q = new URLSearchParams({
    ...(actor ? { actor } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
  });
  const { data, error, forbidden } = useAdminData<{ items: Entry[]; total: number }>(`/admin/audit?${q}`);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="سجل التدقيق" hint={data ? `${data.total} سطر${entityId ? ' لهذا الكيان' : ''} — للقراءة فقط` : undefined} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input className="field__control" placeholder="المنفّذ (بريد أو اسم)" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="المنفّذ" />
        <input className="field__control" placeholder="الإجراء، مثل payout." dir="ltr" value={action} onChange={(e) => setAction(e.target.value)} aria-label="الإجراء" />
        <select className="field__control" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="نوع الكيان">
          <option value="">كل الأنواع</option>
          {['SubOrder', 'Vendor', 'Product', 'PayoutRequest', 'CommissionRule', 'Setting', 'TaxRate', 'ExchangeRate', 'Coupon', 'User', 'Dispute', 'NotificationTemplate', 'CmsPage', 'Banner', 'Review'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty>لا سطور.</Empty>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المنفّذ</th>
                <th>الإجراء</th>
                <th>الكيان</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <Fragment key={e.id}>
                  <tr onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: 'pointer' }}>
                    <td className="small">{when(e.createdAt)}</td>
                    <td className="small">
                      {e.actor?.fullName ?? (e.actorRole ? ROLE_LABEL[e.actorRole] : 'النظام')}
                      <div className="muted" dir="ltr">
                        {e.actor?.email}
                      </div>
                    </td>
                    <td className="num small" dir="ltr">
                      {e.action}
                    </td>
                    <td className="small">
                      {e.entityType}
                      <div className="muted num">{e.entityId?.slice(0, 12)}</div>
                    </td>
                    <td className="num small">{e.ip ?? '—'}</td>
                  </tr>
                  {open === e.id ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="grid-2">
                          <pre className="card small" dir="ltr" style={{ whiteSpace: 'pre-wrap', background: 'var(--danger-subtle)' }}>
                            {JSON.stringify(e.beforeJson, null, 2) ?? '—'}
                          </pre>
                          <pre className="card small" dir="ltr" style={{ whiteSpace: 'pre-wrap', background: 'var(--success-subtle)' }}>
                            {JSON.stringify(e.afterJson, null, 2) ?? '—'}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminAuditPage() {
  return (
    <Suspense>
      <AuditInner />
    </Suspense>
  );
}
