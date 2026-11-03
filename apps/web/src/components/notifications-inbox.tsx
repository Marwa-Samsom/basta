'use client';

import '@/styles/screens/vendor-orders-money.css';
import '@/styles/screens/vendor-extra.css';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, PageHead } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { api } from '@/lib/api';
import { useReturnTick } from '@/lib/fresh';
import { when } from '@/lib/orders';

interface Item {
  id: string;
  code: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Inbox {
  unread: number;
  items: Item[];
  /** معرّف آخر المعروض إن بقي أقدم منه — يُطلب به ما بعده */
  nextCursor: string | null;
  /** ما في التصفية المختارة كلها — «X من Y» */
  total?: number;
  /** عدد كل رمز قالب في الصندوق كله — عدّادات الرقائق */
  counts?: Record<string, number>;
}

export type InboxTone = 'brand' | 'danger' | 'warning' | 'success' | 'money' | 'info';

/** حدث في الصندوق: عنوانه القصير وأيقونته ولونه ومجموعته في التصفية — نمط ST-27 */
export interface InboxEvent {
  title: string;
  icon: IconName;
  tone: InboxTone;
  kind: string;
}

/**
 * صندوق الإشعارات بكثافة اللوحة (compact) — VD-21 للبائع، وللإدارة بأحداثها (28 أكتوبر 2026).
 *
 * الصندوق نفسه الذي يقرؤه الجرس في الشريط العلوي (`/me/notifications`):
 * فتح الإشعار يعلّمه مقروءاً ثم يذهب إلى رابطه، و«تعليم الكل مقروءاً» طلب
 * واحد للخادم. الخادم يعيد آخر 30 إشعاراً، و«الأقدم» يُلحق الثلاثين التالية بموضع آخرها
 * (20 أكتوبر 2026 — كان ما قبل الثلاثين لا يُرى)، و«السابق» يُسقط آخر ما ألحقه.
 *
 * الرقائق (الطلبات، المال…) تصفية من الخادم برموز قوالبها، وعدّاداتها للصندوق كله (3 نوفمبر
 * 2026): كانت تصفّي ما جُلب وتعدّه وحده، فتقول «المال (0)» وفي الصندوق تحويلات أقدم.
 */
export function NotificationsInbox({
  events,
  filters,
  emptyBody,
}: {
  events: Readonly<Record<string, InboxEvent>>;
  /** أولها «الكل» */
  filters: readonly { key: string; label: string }[];
  emptyBody: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // كل ضغطة «الأقدم»: كم أضافت ومن أي مؤشّر بدأت — «السابق» يُسقطها ويعيد المؤشّر
  const [batches, setBatches] = useState<{ count: number; cursor: string }[]>([]);
  const eventOf = (code: string): InboxEvent | { title: string; icon: IconName; tone: InboxTone; kind: null } =>
    events[code] ?? { title: t('إشعار', 'Notification'), icon: 'bell', tone: 'info', kind: null };
  const codesOf = (k: string) => Object.keys(events).filter((code) => events[code]!.kind === k);
  // رقاقة بلا قالب معروف لا تطابق شيئاً — لا تصير «الكل» بالخطأ
  const codes = filter === 'all' ? '' : `&codes=${codesOf(filter).join(',') || '_'}`;
  const query = `/me/notifications?counts=1${codes}`;

  useEffect(() => {
    let alive = true;
    api<Inbox>(query)
      .then((d) => {
        if (!alive) return;
        setInbox(d);
        setBatches([]);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [version, query]);

  // الرجوع إلى الصفحة يجلب الجديد في أعلاها، ويُبقي ما حُمّل من الأقدم تحته
  const returned = useReturnTick();
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);
  useEffect(() => {
    if (!returned) return;
    let alive = true;
    api<Inbox>(queryRef.current)
      .then((d) => {
        if (!alive) return;
        setInbox((cur) =>
          cur
            ? {
                ...d,
                items: [...d.items, ...cur.items.filter((x) => !d.items.some((n) => n.id === x.id))],
                nextCursor: cur.items.length > d.items.length ? cur.nextCursor : d.nextCursor,
              }
            : d,
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [returned]);

  const markAll = async () => {
    setBusy(true);
    try {
      await api('/me/notifications/read', { method: 'POST' });
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const older = async () => {
    if (!inbox?.nextCursor) return;
    const cursor = inbox.nextCursor;
    setLoadingMore(true);
    try {
      const next = await api<Inbox>(`/me/notifications?before=${encodeURIComponent(cursor)}${codes}`);
      const fresh = next.items.filter((n) => !inbox.items.some((x) => x.id === n.id));
      setInbox((cur) => (cur ? { ...cur, unread: next.unread, ...(next.total !== undefined ? { total: next.total } : {}), items: [...cur.items, ...fresh], nextCursor: next.nextCursor } : cur));
      setBatches((b) => [...b, { count: fresh.length, cursor }]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  /** «السابق»: تُسقط آخر ما ألحقه «الأقدم» ويعود مؤشّره، فيُجلب من جديد إن طُلب */
  const less = () => {
    const last = batches.at(-1);
    if (!last) return;
    setInbox((cur) => (cur ? { ...cur, items: cur.items.slice(0, Math.max(0, cur.items.length - last.count)), nextCursor: last.cursor } : cur));
    setBatches((b) => b.slice(0, -1));
  };

  /** تبديل الرقاقة يبدأ من أول الصندوق بتصفيتها — والهيكل يظهر حتى يصل الجديد */
  const pick = (k: string) => {
    if (k === filter) return;
    setInbox(null);
    setError(null);
    setBatches([]);
    setFilter(k);
  };

  const open = async (n: Item) => {
    if (!n.readAt) {
      // التعليم أولاً: الانتقال بعده لا يُسقطه، وفشله لا يمنع الوصول إلى الرابط
      await api(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
      setInbox((cur) =>
        cur
          ? { ...cur, unread: Math.max(0, cur.unread - 1), items: cur.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) }
          : cur,
      );
    }
    if (n.link) router.push(n.link);
  };

  if (!inbox) {
    return error ? (
      <div className="vm-page vx-notifs">
        <PageHead title={t('الإشعارات', 'Notifications')} />
        <Alert tone="danger">{error}</Alert>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">{t('جارٍ فتح الإشعارات…', 'Opening notifications…')}</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const counts = inbox.counts ?? {};
  const all = Object.values(counts).reduce((n, c) => n + c, 0);
  const countOf = (k: string) => (k === 'all' ? all : codesOf(k).reduce((n, code) => n + (counts[code] ?? 0), 0));
  const shown = inbox.items;
  const total = Math.max(inbox.total ?? shown.length, shown.length);

  return (
    <div className="vm-page vx-notifs">
      <PageHead
        title={t('الإشعارات', 'Notifications')}
        meta={
          all
            ? t(`${all} إشعاراً · ${inbox.unread} غير مقروء`, `${all} ${all === 1 ? 'notification' : 'notifications'} · ${inbox.unread} unread`)
            : t('لا إشعارات', 'No notifications')
        }
        actions={
          inbox.unread > 0 ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void markAll()}>
              <Icon name="check" size={14} />
              {t('تعليم الكل مقروءاً', 'Mark all as read')}
            </button>
          ) : null
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="vx-pills" role="group" aria-label={t('تصفية الإشعارات', 'Filter notifications')}>
        {filters.map((f) => (
          <button key={f.key} type="button" className="vx-pill" aria-pressed={filter === f.key} onClick={() => pick(f.key)}>
            {f.label}
            <span className="vx-pill__count">{countOf(f.key)}</span>
          </button>
        ))}
      </div>

      <section className="vx-card vx-card--flush" aria-label={t('قائمة الإشعارات', 'Notification list')}>
        {shown.length === 0 ? (
          <div className="vx-notes-empty">
            <span className="vx-notes-empty__icon" aria-hidden>
              <Icon name="bell" size={24} />
            </span>
            <p className="vx-notes-empty__title">{t('لا إشعارات', 'No notifications')}</p>
            <p className="vx-notes-empty__body">{emptyBody}</p>
          </div>
        ) : (
          <ul className="vx-notes">
            {shown.map((n) => {
              const ev = eventOf(n.code);
              const unread = !n.readAt;
              return (
                <li key={n.id} className={`vx-note${unread ? ' vx-note--unread' : ''}`}>
                  <button type="button" className="vx-note__row" onClick={() => void open(n)}>
                    <span className={`vx-note__icon vx-note__icon--${ev.tone}`} aria-hidden>
                      <Icon name={ev.icon} size={16} />
                    </span>
                    <span className="vx-note__text">
                      <span className="vx-note__title">
                        {unread ? <span className="visually-hidden">{t('غير مقروء: ', 'Unread: ')}</span> : null}
                        {ev.title}
                      </span>
                      {n.body ? <span className="vx-note__body">{n.body}</span> : null}
                    </span>
                    <span className="vx-note__meta">
                      <span className="vx-note__time">{when(n.createdAt, locale)}</span>
                      {unread ? <span className="vx-note__dot" aria-hidden /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {inbox.nextCursor || batches.length > 0 ? (
          <div className="list-more">
            <span className="list-more__count num">{t(`${shown.length} من ${total}`, `${shown.length} of ${total}`)}</span>
            {batches.length > 0 ? (
              <button type="button" className="btn btn--ghost btn--sm" disabled={loadingMore} onClick={less}>
                {t('السابق', 'Previous')}
              </button>
            ) : null}
            {inbox.nextCursor ? (
              <button type="button" className="btn btn--secondary btn--sm" disabled={loadingMore} onClick={() => void older()}>
                {loadingMore ? t('جارٍ التحميل…', 'Loading…') : t('الأقدم', 'Older')}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
