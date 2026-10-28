'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, session } from '@/lib/api';
import { when } from '@/lib/orders';
import { Icon } from '@/components/icons';

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
/**
 * «كل الإشعارات» إلى صندوق المنطقة نفسها — كان للجميع صفحة المشتري، والبائع له صندوقه والمدير
 * صار له صندوقه (28 أكتوبر 2026).
 */
export function NotificationBell({ allHref = '/account/notifications' }: { allHref?: string } = {}) {
  const signedIn = useSyncExternalStore(subscribe, () => !!session.read(), () => false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // تُغلق بنقرة في أي مكان خارجها أو بـ Esc — لا بالجرس وحده
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
    <div className="bell" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-label={`الإشعارات${inbox?.unread ? ` — ${inbox.unread} غير مقروء` : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={18} />
        {inbox?.unread ? <span className="icon-btn__dot" aria-hidden /> : null}
      </button>
      {open ? (
        <div className="bell__panel">
          <div className="bell__head">
            <strong>الإشعارات</strong>
            {inbox?.unread ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void readAll()}>
                تعليم الكل مقروءاً
              </button>
            ) : null}
          </div>
          {!inbox || inbox.items.length === 0 ? <p className="bell__empty">لا إشعارات.</p> : null}
          {inbox?.items.map((n) => (
            <div key={n.id} className="bell__item" data-unread={!n.readAt}>
              {n.link ? (
                <Link href={n.link} onClick={() => setOpen(false)}>
                  {n.body}
                </Link>
              ) : (
                <span>{n.body}</span>
              )}
              <span className="bell__when">{when(n.createdAt)}</span>
            </div>
          ))}
          <div className="bell__head">
            <Link
              href={allHref}
              className="btn btn--ghost btn--sm btn--block"
              onClick={() => setOpen(false)}
            >
              كل الإشعارات
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
