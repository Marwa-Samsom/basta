'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Spinner, TextArea } from '@/components/ui';
import { api } from '@/lib/api';
import { DISPUTE_REASONS, DISPUTE_STATUS, ROLE_LABEL, when } from '@/lib/orders';

interface Dispute {
  id: string;
  reasonCode: string;
  status: string;
  createdAt: string;
  resolution: string | null;
  messages: { id: string; senderRole: string; body: string; createdAt: string }[];
  subOrder: { id: string; subOrderNumber: string; status: string; vendor: { nameAr: string }; order: { orderNumber: string } };
}

/**
 * خيط النزاع — ST-21 للمشتري و VD-17 للبائع، بالمكوّن نفسه.
 * `base` يحدّد الجمهور: /me/disputes أو /vendor/disputes. الخادم يقيّد
 * النطاق، فالمكوّن لا يعرف من يحقّ له ماذا.
 */
export function DisputeThread({ id, base, me, back }: { id: string; base: string; me: 'customer' | 'vendor'; back: string }) {
  const [d, setD] = useState<Dispute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await api<Dispute>(`${base}/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base, id]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await api<Dispute>(`${base}/${id}`);
        if (alive) setD(next);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [base, id]);

  const act = async (path: string, payload?: unknown) => {
    setBusy(true);
    try {
      await api(`${base}/${id}${path}`, { method: 'POST', ...(payload ? { body: payload } : {}) });
      setBody('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!d) return error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح النزاع…" />;
  const open = d.status === 'open' || d.status === 'escalated';
  const mine = (role: string) => (me === 'customer' ? role === 'customer' : role.startsWith('vendor'));

  return (
    <div className="stack stack--loose">
      <header className="stack stack--tight">
        <Link href={back} className="small">
          → رجوع
        </Link>
        <h1>{DISPUTE_REASONS[d.reasonCode] ?? d.reasonCode}</h1>
        <p className="small muted">
          {d.subOrder.vendor.nameAr} · <span className="num">{d.subOrder.subOrderNumber}</span> · {when(d.createdAt)} ·{' '}
          <span className="badge badge--warning">{DISPUTE_STATUS[d.status] ?? d.status}</span>
        </p>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {d.status === 'escalated' ? <Alert tone="info">النزاع لدى الإدارة الآن. مال هذا الطلب مجمَّد حتى الحسم.</Alert> : null}
      {d.resolution ? <Alert tone="success" title="قرار الإدارة">{d.resolution}</Alert> : null}

      <Card>
        <ol className="stack">
          {d.messages.map((m) => (
            <li key={m.id} className="stack stack--tight" style={{ alignItems: mine(m.senderRole) ? 'flex-start' : 'flex-end' }}>
              <span className="small muted">
                {mine(m.senderRole) ? 'أنت' : ROLE_LABEL[m.senderRole] ?? m.senderRole} · {when(m.createdAt)}
              </span>
              <p className="card" style={{ margin: 0, maxWidth: '36rem' }}>
                {m.body}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {open ? (
        <div className="stack">
          <TextArea label="ردّك" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={busy || !body.trim()} onClick={() => void act('/messages', { body })}>
              إرسال
            </button>
            {d.status === 'open' ? (
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void act('/escalate')}>
                تصعيد للإدارة
              </button>
            ) : null}
            {me === 'customer' ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void act('/withdraw')}>
                سحب النزاع — حُلّت المشكلة
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** قائمة النزاعات — لكلا الجمهورين */
export function DisputeList({ base, link }: { base: string; link: (id: string) => string }) {
  const [rows, setRows] = useState<
    { id: string; reasonCode: string; status: string; createdAt: string; subOrder: { subOrderNumber: string; vendor: { nameAr: string } }; _count: { messages: number } }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<typeof rows>(base)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [base]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <p className="empty muted">لا نزاعات.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>الطلب</th>
            <th>السبب</th>
            <th>الرسائل</th>
            <th>التاريخ</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={link(r.id)} className="num">
                  {r.subOrder.subOrderNumber}
                </Link>
                <div className="small muted">{r.subOrder.vendor.nameAr}</div>
              </td>
              <td>{DISPUTE_REASONS[r.reasonCode] ?? r.reasonCode}</td>
              <td className="num">{r._count.messages}</td>
              <td className="small">{when(r.createdAt)}</td>
              <td>
                <span className="badge badge--warning">{DISPUTE_STATUS[r.status] ?? r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
