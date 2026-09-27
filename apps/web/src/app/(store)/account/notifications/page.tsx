'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { api, session } from '@/lib/api';
import { NOTIFICATIONS_CHANGED } from '@/lib/addresses';
import { when } from '@/lib/orders';

interface Item {
  id: string;
  code: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Page {
  unread: number;
  items: Item[];
  nextCursor?: string | null;
}

type Tone = 'brand' | 'info' | 'success' | 'danger' | 'warning' | 'neutral';

/**
 * عنوان كل حدث وأيقونته — النصّ نفسه يأتي من القالب كما أُرسل، والعنوان هنا
 * سطر قصير يقول نوع الخبر قبل تفصيله. حدث غير معروف يُعرض بنصّه وحده.
 */
const KINDS: Record<string, { title: string; icon: IconName; tone: Tone }> = {
  order_placed: { title: 'تأكّد طلبك', icon: 'check-circle', tone: 'success' },
  order_status_changed: { title: 'تغيّرت حالة طلبك', icon: 'package', tone: 'brand' },
  order_canceled: { title: 'أُلغي جزء من طلبك', icon: 'alert', tone: 'danger' },
  refund_issued: { title: 'أُعيد إليك مبلغ', icon: 'wallet', tone: 'success' },
  dispute_message: { title: 'رسالة جديدة في نزاعك', icon: 'shield', tone: 'info' },
  vendor_new_order: { title: 'طلب جديد لمتجرك', icon: 'package', tone: 'brand' },
  return_requested: { title: 'طلب إرجاع جديد', icon: 'return', tone: 'warning' },
  payout_paid: { title: 'نُفّذ تحويل رصيدك', icon: 'wallet', tone: 'success' },
  payout_rejected: { title: 'رُفض طلب السحب', icon: 'alert', tone: 'danger' },
  vendor_approved: { title: 'قُبل متجرك', icon: 'store', tone: 'success' },
  vendor_rejected: { title: 'لم يُقبل متجرك', icon: 'store', tone: 'danger' },
  product_rejected: { title: 'أُعيد منتج إليك للتعديل', icon: 'alert', tone: 'warning' },
  low_stock: { title: 'مخزون منخفض', icon: 'boxes', tone: 'warning' },
  message_to_customer: { title: 'ردّ من متجر', icon: 'msg', tone: 'brand' },
  message_to_vendor: { title: 'رسالة من مشترٍ', icon: 'msg', tone: 'brand' },
  bank_account_added: { title: 'أُضيف حساب بنكي', icon: 'shield', tone: 'warning' },
  bank_account_verified: { title: 'وُثّق حساب بنكي', icon: 'check-circle', tone: 'success' },
  recovery_code_used: { title: 'استُعمل رمز استعادة', icon: 'shield', tone: 'warning' },
  totp_reset_by_admin: { title: 'أُعيد ضبط التحقّق بخطوتين', icon: 'shield', tone: 'danger' },
};
const FALLBACK = { title: '', icon: 'bell' as IconName, tone: 'neutral' as Tone };

const PAGE_SIZE = 20;
const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** اليوم · أمس · هذا الأسبوع · أقدم — بتقويم المتصفّح المحلي */
function groupOf(iso: string, now: Date): string {
  const diff = startOfDay(now) - startOfDay(new Date(iso));
  if (diff <= 0) return 'اليوم';
  if (diff <= DAY) return 'أمس';
  if (diff < 7 * DAY) return 'هذا الأسبوع';
  return 'أقدم';
}

const clock = new Intl.DateTimeFormat('ar-u-nu-latn', { timeStyle: 'short' });

function unreadText(n: number): string {
  if (n === 0) return 'كل الإشعارات مقروءة';
  if (n === 1) return 'إشعار واحد غير مقروء';
  if (n === 2) return 'إشعاران غير مقروءين';
  if (n <= 10) return `${n} إشعارات غير مقروءة`;
  return `${n} إشعاراً غير مقروء`;
}

/**
 * ST-27 — مركز الإشعارات.
 *
 * قائمة زمنية مجمّعة باليوم، غير المقروء مميَّز بخلفية ونقطة ووزن. النقر
 * يعلّم الإشعار مقروءاً ويذهب إلى رابطه. «غير المقروء» تصفية من الخادم،
 * و«حمّل المزيد» صفحة تالية بمؤشّر — لا حدّ ثلاثين كما في الجرس.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const fetchPage = useCallback(
    (before: string | null) =>
      api<Page>(
        `/me/notifications?limit=${PAGE_SIZE}${filter === 'unread' ? '&unread=1' : ''}${before ? `&before=${before}` : ''}`,
      ),
    [filter],
  );

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/account/notifications');
      return;
    }
    let alive = true;
    fetchPage(null)
      .then((p) => {
        if (!alive) return;
        setItems(p.items);
        setUnread(p.unread);
        setCursor(p.nextCursor ?? null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [router, fetchPage]);

  async function more(): Promise<void> {
    if (!cursor) return;
    setBusy(true);
    try {
      const p = await fetchPage(cursor);
      setItems((list) => [...(list ?? []), ...p.items]);
      setUnread(p.unread);
      setCursor(p.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر جلب المزيد.');
    } finally {
      setBusy(false);
    }
  }

  /** تبديل العرض يبدأ من أول الصفحة — والهيكل يظهر حتى يصل الجديد */
  function show(next: 'all' | 'unread'): void {
    if (next === filter) return;
    setItems(null);
    setError(null);
    setCursor(null);
    setFilter(next);
  }

  const announce = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

  function markOne(n: Item): void {
    if (n.readAt) return;
    const now = new Date().toISOString();
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)) ?? list);
    setUnread((u) => Math.max(0, u - 1));
    // الطلب يكمل ولو انتقلت الصفحة: التنقّل داخل التطبيق لا يقطع fetch
    void api(`/me/notifications/${n.id}/read`, { method: 'POST' })
      .then(announce)
      .catch(() => undefined);
  }

  async function markAll(): Promise<void> {
    setBusy(true);
    try {
      await api('/me/notifications/read', { method: 'POST' });
      const now = new Date().toISOString();
      setItems((list) => list?.map((x) => (x.readAt ? x : { ...x, readAt: now })) ?? list);
      setUnread(0);
      setStatus('عُلّمت كل الإشعارات كمقروءة.');
      announce();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تعليم الإشعارات.');
    } finally {
      setBusy(false);
    }
  }

  // في «غير المقروء» يبقى ما قُرئ للتوّ ظاهراً حتى إعادة التحميل — لا يقفز من تحت المؤشّر
  const shown = items ?? [];
  const now = new Date();
  const groups: { label: string; items: Item[] }[] = [];
  for (const n of shown) {
    const label = groupOf(n.createdAt, now);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="aa-page">
      <PageHead
        title="الإشعارات"
        {...(items ? { count: unreadText(unread) } : {})}
        actions={
          <>
            <span className="seg" role="group" aria-label="عرض">
              <button
                type="button"
                className="seg__opt"
                aria-pressed={filter === 'all'}
                onClick={() => show('all')}
              >
                الكل
              </button>
              <button
                type="button"
                className="seg__opt"
                aria-pressed={filter === 'unread'}
                onClick={() => show('unread')}
              >
                غير المقروء
              </button>
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || unread === 0}
              onClick={() => void markAll()}
            >
              <Icon name="check" size={15} />
              علّم الكل كمقروء
            </button>
          </>
        }
      />

      <p className="visually-hidden" role="status">
        {status}
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!items && !error ? (
        <div className="stack" role="status">
          <span className="visually-hidden">جارٍ جلب الإشعارات…</span>
          <span className="skeleton aa-skel__card" aria-hidden />
        </div>
      ) : null}

      {items && items.length === 0 ? (
        filter === 'unread' ? (
          <EmptyState icon="bell" title="لا إشعارات غير مقروءة">
            قرأتَ كل شيء. بدّل إلى «الكل» لتصفّح السجلّ.
          </EmptyState>
        ) : (
          <EmptyState icon="bell" title="لا إشعارات بعد">
            نخبرك هنا بتغيّر حالة طلباتك وردود المتاجر وقرارات النزاعات.
          </EmptyState>
        )
      ) : null}

      {items && items.length > 0 ? (
        <div className="aa-notifs">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <div className="aa-notifs__label" aria-hidden>
                {g.label}
              </div>
              <ul className="aa-notifs__group">
                {g.items.map((n) => {
                  const kind = KINDS[n.code] ?? FALLBACK;
                  const title = kind.title || n.body || 'إشعار';
                  const body = kind.title ? n.body : null;
                  const isUnread = !n.readAt;
                  const time = groupOf(n.createdAt, now) === 'اليوم' ? clock.format(new Date(n.createdAt)) : when(n.createdAt);
                  const content = (
                    <>
                      <span className="aa-notif__icon" data-tone={kind.tone} aria-hidden>
                        <Icon name={kind.icon} size={17} />
                      </span>
                      <span className="aa-notif__text">
                        <span className="aa-notif__title">
                          {title}
                          {isUnread ? (
                            <>
                              <span className="aa-notif__dot" aria-hidden />
                              <span className="visually-hidden"> — غير مقروء</span>
                            </>
                          ) : null}
                        </span>
                        {body ? <span className="aa-notif__body">{body}</span> : null}
                      </span>
                      <span className="aa-notif__side">
                        <time className="aa-notif__time" dateTime={n.createdAt}>
                          {time}
                        </time>
                        {n.link ? <Icon name="chev-end" size={15} mirror /> : null}
                      </span>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link
                          href={n.link}
                          className="aa-notif"
                          data-unread={isUnread}
                          onClick={() => markOne(n)}
                        >
                          {content}
                        </Link>
                      ) : isUnread ? (
                        <button type="button" className="aa-notif" data-unread onClick={() => markOne(n)}>
                          {content}
                        </button>
                      ) : (
                        <div className="aa-notif aa-notif--static">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {cursor ? (
            <div className="aa-more">
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void more()}>
                {busy ? <span className="spinner" aria-hidden /> : null}
                حمّل المزيد
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
