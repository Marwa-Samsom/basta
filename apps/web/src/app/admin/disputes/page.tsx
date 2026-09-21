'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, Tabs } from '@/components/admin';
import { Card, TextArea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { DISPUTE_REASONS, DISPUTE_STATUS, ROLE_LABEL, labelOf, when } from '@/lib/orders';

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

/**
 * AD-14 — النزاعات. المصعَّد أولاً، ومال الطلب مجمَّد حتى الحسم (ADR-007).
 * الحسم للمشتري يكتمل بإجراء الطلب نفسه (إلغاء أو استلام مرتجع من صفحة
 * الطلبات) — القرار هنا يوثّق الحكم ويفكّ التجميد.
 */
export default function AdminDisputesPage() {
  const [status, setStatus] = useState('escalated');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, forbidden, reload } = useAdminData<Row[]>(`/admin/disputes?status=${status}`);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="النزاعات" hint="الرصيد مجمَّد ما دام النزاع مفتوحاً." />
      <Tabs value={status} onChange={setStatus} options={['escalated', 'open', 'resolved_customer', 'resolved_vendor', 'withdrawn'].map((k) => ({ key: k, label: DISPUTE_STATUS[k]! }))} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.length === 0 ? (
        <Card>
          <Empty>لا نزاعات هنا.</Empty>
        </Card>
      ) : (
        data.map((d) => (
          <Card key={d.id}>
            <button type="button" style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', width: '100%' }} onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              <span>
                <strong>{DISPUTE_REASONS[d.reasonCode] ?? d.reasonCode}</strong> · {d.subOrder.vendor.nameAr}
                <div className="small muted num">
                  {d.subOrder.subOrderNumber} · {when(d.createdAt)} · {d._count.messages} رسالة
                </div>
              </span>
              <span className="badge badge--warning">{DISPUTE_STATUS[d.status] ?? d.status}</span>
            </button>
            {openId === d.id ? <DisputeDetail id={d.id} onChange={reload} /> : null}
          </Card>
        ))
      )}
    </div>
  );
}

function DisputeDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, error, reload } = useAdminData<Thread>(`/admin/disputes/${id}`);
  const act = useAction();
  const [body, setBody] = useState('');
  const [resolution, setResolution] = useState('');
  if (!data) return <Loading error={error} />;
  const open = data.status === 'open' || data.status === 'escalated';

  const resolve = (outcome: 'customer' | 'vendor') =>
    act.run(async () => {
      await api(`/admin/disputes/${id}/resolve`, { method: 'POST', body: { outcome, resolution } });
      reload();
      onChange();
    }, 'حُسم النزاع وفُكّ تجميد الرصيد.');

  return (
    <div className="stack">
      <Feedback error={act.error} notice={act.notice} />
      <p className="small">
        حالة الطلب: {labelOf(data.subOrder.status)} · الطلب <span className="num">{data.subOrder.order.orderNumber}</span>
      </p>
      <ol className="stack">
        {data.messages.map((m) => (
          <li key={m.id} className="card small">
            <strong>{ROLE_LABEL[m.senderRole] ?? m.senderRole}</strong> · <span className="muted">{when(m.createdAt)}</span>
            <p style={{ margin: 0 }}>{m.body}</p>
          </li>
        ))}
      </ol>
      {data.resolution ? <p className="small">القرار: «{data.resolution}»</p> : null}
      {open ? (
        <>
          <TextArea label="رسالة للطرفين" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={act.busy || !body.trim()}
            onClick={() =>
              void act.run(async () => {
                await api(`/admin/disputes/${id}/messages`, { method: 'POST', body: { body } });
                setBody('');
                reload();
              })
            }
          >
            إرسال
          </button>
          <TextArea label="القرار المكتوب — يُعرض للطرفين" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} />
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" disabled={act.busy || resolution.trim().length < 5} onClick={() => void resolve('customer')}>
              حسم للمشتري
            </button>
            <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy || resolution.trim().length < 5} onClick={() => void resolve('vendor')}>
              حسم للبائع
            </button>
          </div>
          <p className="small muted">الحسم للمشتري: أكمل الاسترداد من «الطلبات» (إلغاء) أو «المرتجعات» (استلام) — كلاهما يقيّد الدفتر ويردّ المال.</p>
        </>
      ) : null}
    </div>
  );
}
