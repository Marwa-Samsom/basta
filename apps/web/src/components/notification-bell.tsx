'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, session } from '@/lib/api';
import { when } from '@/lib/orders';

interface Inbox {
  unread: number;
  items: { id: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[];
}

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * الإشعارات داخل الموقع — القناة الوحيدة التي لا تحتاج بريداً ولا هاتفاً.
 * تُسأل كل دقيقة، وتظهر لمن دخل وحده.
 */
export function NotificationBell() {
  const signedIn = useSyncExternalStore(subscribe, () => !!session.read(), () => false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const load = () =>
      api<Inbox>('/me/notifications')
        .then((d) => alive && setInbox(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [signedIn, version]);

  if (!signedIn) return null;

  const readAll = async () => {
    await api('/me/notifications/read', { method: 'POST' }).catch(() => undefined);
    setVersion((v) => v + 1);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-expanded={open}
        aria-label={`الإشعارات${inbox?.unread ? ` — ${inbox.unread} غير مقروء` : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        الإشعارات{inbox?.unread ? <span className="badge badge--warning num"> {inbox.unread}</span> : null}
      </button>
      {open ? (
        <div className="card stack stack--tight" style={{ position: 'absolute', insetInlineEnd: 0, insetBlockStart: '110%', width: 'min(22rem, 90vw)', zIndex: 20, maxHeight: '60vh', overflowY: 'auto' }}>
          <div className="row row--between">
            <strong>الإشعارات</strong>
            {inbox?.unread ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void readAll()}>
                تعليم الكل مقروءاً
              </button>
            ) : null}
          </div>
          {!inbox || inbox.items.length === 0 ? <p className="small muted">لا إشعارات.</p> : null}
          {inbox?.items.map((n) => (
            <div key={n.id} className="small" style={{ fontWeight: n.readAt ? 'normal' : 'bold' }}>
              {n.link ? (
                <Link href={n.link} onClick={() => setOpen(false)}>
                  {n.body}
                </Link>
              ) : (
                n.body
              )}
              <div className="muted">{when(n.createdAt)}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
