'use client';

import '@/styles/screens/vendor-extra.css';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, PageHead } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { api } from '@/lib/api';
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
}

type Kind = 'order' | 'product' | 'stock' | 'payout' | 'dispute' | 'store';
type Tone = 'brand' | 'danger' | 'warning' | 'success' | 'money' | 'info';

/** كل حدث: عنوانه القصير وأيقونته ولونه ومجموعته في التصفية — نمط ST-27 */
const EVENTS: Record<string, { title: string; icon: IconName; tone: Tone; kind: Kind }> = {
  vendor_new_order: { title: 'طلب جديد بانتظار قبولك', icon: 'truck', tone: 'brand', kind: 'order' },
  return_requested: { title: 'طلب إرجاع جديد', icon: 'return', tone: 'warning', kind: 'dispute' },
  dispute_message: { title: 'رسالة في نزاع', icon: 'msg', tone: 'danger', kind: 'dispute' },
  product_rejected: { title: 'لم يُنشر منتجك', icon: 'alert', tone: 'danger', kind: 'product' },
  low_stock: { title: 'مخزون قارب النفاد', icon: 'boxes', tone: 'warning', kind: 'stock' },
  payout_paid: { title: 'حُوِّل مبلغ إلى حسابك', icon: 'check-circle', tone: 'money', kind: 'payout' },
  payout_rejected: { title: 'رُفض طلب سحب', icon: 'wallet', tone: 'danger', kind: 'payout' },
  vendor_approved: { title: 'اعتُمد متجرك', icon: 'check-circle', tone: 'success', kind: 'store' },
  vendor_rejected: { title: 'طلب انضمامك يحتاج تعديلاً', icon: 'store', tone: 'warning', kind: 'store' },
  message_to_vendor: { title: 'رسالة من مشترٍ', icon: 'msg', tone: 'brand', kind: 'order' },
  bank_account_added: { title: 'أُضيف حساب بنكي', icon: 'shield', tone: 'warning', kind: 'payout' },
  bank_account_verified: { title: 'وُثّق حسابك البنكي', icon: 'check-circle', tone: 'success', kind: 'payout' },
  recovery_code_used: { title: 'استُعمل رمز استعادة', icon: 'shield', tone: 'warning', kind: 'store' },
  totp_reset_by_admin: { title: 'أُعيد ضبط التحقّق بخطوتين', icon: 'shield', tone: 'danger', kind: 'store' },
};
const eventOf = (code: string) => EVENTS[code] ?? { title: 'إشعار', icon: 'bell' as IconName, tone: 'info' as Tone, kind: null };

const FILTERS: { key: Kind | 'all'; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'order', label: 'الطلبات' },
  { key: 'product', label: 'المنتجات' },
  { key: 'stock', label: 'المخزون' },
  { key: 'payout', label: 'المال' },
  { key: 'dispute', label: 'النزاعات' },
];

/**
 * VD-21 — الإشعارات بكثافة اللوحة (compact)، على نمط ST-27.
 *
 * الصندوق نفسه الذي يقرؤه الجرس في الشريط العلوي (`/me/notifications`):
 * فتح الإشعار يعلّمه مقروءاً ثم يذهب إلى رابطه، و«تعليم الكل مقروءاً» طلب
 * واحد للخادم. الخادم يعيد آخر 30 إشعاراً.
 */
export default function VendorNotificationsPage() {
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    api<Inbox>('/me/notifications')
      .then((d) => alive && setInbox(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [version]);

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

  const open = async (n: Item) => {
    if (!n.readAt) {
      // التعليم أولاً: الانتقال بعده لا يُسقطه، وفشله لا يمنع الوصول إلى الرابط
      await api(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
      setInbox((cur) =>
        cur
          ? { unread: Math.max(0, cur.unread - 1), items: cur.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) }
          : cur,
      );
    }
    if (n.link) router.push(n.link);
  };

  if (!inbox) {
    return error ? (
      <div className="vm-page vx-notifs">
        <PageHead title="الإشعارات" />
        <Alert tone="danger">{error}</Alert>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">جارٍ فتح الإشعارات…</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const countOf = (k: Kind | 'all') => (k === 'all' ? inbox.items.length : inbox.items.filter((n) => eventOf(n.code).kind === k).length);
  const shown = inbox.items.filter((n) => filter === 'all' || eventOf(n.code).kind === filter);

  return (
    <div className="vm-page vx-notifs">
      <PageHead
        title="الإشعارات"
        meta={inbox.items.length ? `${inbox.items.length} إشعاراً · ${inbox.unread} غير مقروء` : 'لا إشعارات'}
        actions={
          inbox.unread > 0 ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void markAll()}>
              <Icon name="check" size={14} />
              تعليم الكل مقروءاً
            </button>
          ) : null
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="vx-pills" role="group" aria-label="تصفية الإشعارات">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="vx-pill" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            <span className="vx-pill__count">{countOf(f.key)}</span>
          </button>
        ))}
      </div>

      <section className="vx-card vx-card--flush" aria-label="قائمة الإشعارات">
        {shown.length === 0 ? (
          <div className="vx-notes-empty">
            <span className="vx-notes-empty__icon" aria-hidden>
              <Icon name="bell" size={24} />
            </span>
            <p className="vx-notes-empty__title">لا إشعارات</p>
            <p className="vx-notes-empty__body">كل شيء هادئ. الطلبات الجديدة وقرارات المراجعة وتنبيهات المخزون تظهر هنا.</p>
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
                        {unread ? <span className="visually-hidden">غير مقروء: </span> : null}
                        {ev.title}
                      </span>
                      {n.body ? <span className="vx-note__body">{n.body}</span> : null}
                    </span>
                    <span className="vx-note__meta">
                      <span className="vx-note__time">{when(n.createdAt)}</span>
                      {unread ? <span className="vx-note__dot" aria-hidden /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
