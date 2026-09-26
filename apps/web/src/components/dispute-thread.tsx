'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, EmptyState, PageHead, Spinner } from '@/components/ui';
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

/** لون الحالة: المفتوح ينتظر ردّاً، والمصعَّد لدى الإدارة، والمحسوم انتهى */
const STATUS_TONE: Record<string, string> = {
  open: 'badge--warning',
  escalated: 'badge--info',
  withdrawn: 'badge--pending',
  resolved_customer: 'badge--approved',
  resolved_vendor: 'badge--approved',
};
const toneOf = (status: string): string => STATUS_TONE[status] ?? 'badge--pending';

/**
 * خيط النزاع — ST-21 للمشتري و VD-17 للبائع، بالمكوّن نفسه.
 * `base` يحدّد الجمهور: /me/disputes أو /vendor/disputes. الخادم يقيّد
 * النطاق، فالمكوّن لا يعرف من يحقّ له ماذا.
 *
 * الأنماط تقرأ متغيّرات الكثافة، فيبدو الخيط مريحاً في المتجر ومضغوطاً في لوحة البائع.
 */
export function DisputeThread({ id, base, me, back }: { id: string; base: string; me: 'customer' | 'vendor'; back: string }) {
  const [d, setD] = useState<Dispute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const replyId = useId();

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

  const backLink = (
    <Link href={back} className="sp-back">
      <Icon name="back" size={16} mirror />
      رجوع
    </Link>
  );

  if (!d) {
    return (
      <div className="sp-dispute">
        {backLink}
        {error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح النزاع…" />}
      </div>
    );
  }
  const open = d.status === 'open' || d.status === 'escalated';
  const mine = (role: string) => (me === 'customer' ? role === 'customer' : role.startsWith('vendor'));

  return (
    <div className="sp-dispute">
      {backLink}
      <PageHead title={DISPUTE_REASONS[d.reasonCode] ?? d.reasonCode} meta={`فُتح ${when(d.createdAt)}`} />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {d.status === 'escalated' ? <Alert tone="info">النزاع لدى الإدارة الآن. مال هذا الطلب مجمَّد حتى الحسم.</Alert> : null}
      {d.resolution ? <Alert tone="success" title="قرار الإدارة">{d.resolution}</Alert> : null}

      <section className="sp-thread" aria-label="رسائل النزاع">
        <header className="sp-thread__head">
          <span className="tile-icon sp-tile" aria-hidden>
            <Icon name="store" size={16} />
          </span>
          <span className="sp-thread__who">
            <span className="sp-thread__shop">{d.subOrder.vendor.nameAr}</span>
            <span className="sp-thread__ctx">
              الطلب <span className="num">{d.subOrder.order.orderNumber}</span> · الشحنة{' '}
              <span className="num">{d.subOrder.subOrderNumber}</span>
            </span>
          </span>
          <span className={`badge ${toneOf(d.status)}`}>{DISPUTE_STATUS[d.status] ?? d.status}</span>
        </header>

        {d.messages.length ? (
          <ol className="sp-thread__list">
            {d.messages.map((m) => {
              const own = mine(m.senderRole);
              const kind = own ? 'sp-msg--mine' : m.senderRole === 'admin' ? 'sp-msg--admin' : '';
              return (
                <li key={m.id} className={`sp-msg ${kind}`}>
                  <div className="sp-msg__box">
                    <div className="sp-msg__meta">
                      <span className="sp-msg__role">{own ? 'أنت' : ROLE_LABEL[m.senderRole] ?? m.senderRole}</span>
                      <span className="sp-msg__time">{when(m.createdAt)}</span>
                    </div>
                    <p className="sp-msg__body">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="sp-thread__list sp-thread__empty">لا رسائل بعد.</p>
        )}

        {open ? (
          <div className="sp-composer">
            <label className="visually-hidden" htmlFor={replyId}>
              ردّك
            </label>
            <textarea
              id={replyId}
              className="field__control"
              rows={3}
              placeholder="اكتب ردّك…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="sp-composer__actions">
              {d.status === 'open' ? (
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void act('/escalate')}>
                  <Icon name="shield" size={14} />
                  تصعيد للإدارة
                </button>
              ) : null}
              {me === 'customer' ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act('/withdraw')}>
                  سحب النزاع — حُلّت المشكلة
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--primary sp-composer__send"
                disabled={busy || !body.trim()}
                onClick={() => void act('/messages', { body })}
              >
                <Icon name="send" size={15} mirror />
                إرسال
              </button>
            </div>
          </div>
        ) : null}
      </section>
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
  if (rows.length === 0) {
    return (
      <EmptyState icon="msg" title="لا نزاعات">
        حين يُفتح نزاع على طلب يظهر هنا بخيط رسائله وحالته.
      </EmptyState>
    );
  }
  return (
    <div className="table-wrap sp-dlist">
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
              <td data-label="الطلب">
                <span className="stack stack--tight">
                  <Link href={link(r.id)} className="num">
                    {r.subOrder.subOrderNumber}
                  </Link>
                  <span className="sp-dlist__vendor">{r.subOrder.vendor.nameAr}</span>
                </span>
              </td>
              <td data-label="السبب">{DISPUTE_REASONS[r.reasonCode] ?? r.reasonCode}</td>
              <td data-label="الرسائل" className="num">
                {r._count.messages}
              </td>
              <td data-label="التاريخ" className="small">
                {when(r.createdAt)}
              </td>
              <td data-label="الحالة">
                <span className={`badge ${toneOf(r.status)}`}>{DISPUTE_STATUS[r.status] ?? r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
