'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { api, session } from '@/lib/api';
import { NOTIFICATIONS_CHANGED } from '@/lib/addresses';
import { intlLocale, type Locale, type Translate } from '@/lib/i18n';
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

interface Page {
  unread: number;
  items: Item[];
  nextCursor?: string | null;
  /** إشعارات العرض كلها (الكل أو غير المقروء) — «X من Y» */
  total?: number;
}

type Tone = 'brand' | 'info' | 'success' | 'danger' | 'warning' | 'neutral';

/**
 * عنوان كل حدث وأيقونته — النصّ نفسه يأتي من القالب كما أُرسل، والعنوان هنا
 * سطر قصير يقول نوع الخبر قبل تفصيله. حدث غير معروف يُعرض بنصّه وحده.
 */
const KINDS: Record<string, { title: string; en: string; icon: IconName; tone: Tone }> = {
  order_placed: { title: 'تأكّد طلبك', en: 'Your order is confirmed', icon: 'check-circle', tone: 'success' },
  order_status_changed: { title: 'تغيّرت حالة طلبك', en: 'Your order status changed', icon: 'package', tone: 'brand' },
  order_shipped: { title: 'شُحن طلبك', en: 'Your order has shipped', icon: 'truck', tone: 'brand' },
  order_canceled: { title: 'أُلغي جزء من طلبك', en: 'Part of your order was canceled', icon: 'alert', tone: 'danger' },
  return_rejected: { title: 'رُفض طلب الإرجاع', en: 'Return request rejected', icon: 'alert', tone: 'warning' },
  refund_issued: { title: 'أُعيد إليك مبلغ', en: 'An amount was refunded to you', icon: 'wallet', tone: 'success' },
  refund_transferred: { title: 'حوّلنا لك مبلغاً', en: 'We transferred an amount to you', icon: 'wallet', tone: 'success' },
  order_awaiting_transfer: { title: 'طلبك بانتظار تحويلك', en: 'Your order is awaiting your transfer', icon: 'clock', tone: 'warning' },
  transfer_expired: { title: 'أُلغي طلب لم يصل تحويله', en: "An order was canceled — its transfer didn't arrive", icon: 'alert', tone: 'danger' },
  dispute_message: { title: 'رسالة جديدة في نزاعك', en: 'New message in your dispute', icon: 'shield', tone: 'info' },
  dispute_escalated: { title: 'صُعِّد نزاعك للإدارة', en: 'Your dispute was escalated to admin', icon: 'shield', tone: 'warning' },
  dispute_resolved: { title: 'حُسم نزاعك', en: 'Your dispute was resolved', icon: 'shield', tone: 'info' },
  late_payment_refunded: { title: 'رددنا دفعاً وصل متأخراً', en: 'We returned a payment that arrived late', icon: 'wallet', tone: 'info' },
  vendor_new_order: { title: 'طلب جديد لمتجرك', en: 'New order for your shop', icon: 'package', tone: 'brand' },
  vendor_order_canceled: { title: 'أُلغي طلب لمتجرك', en: 'An order for your shop was canceled', icon: 'alert', tone: 'danger' },
  vendor_dispute_opened: { title: 'نزاع جديد على طلب لمتجرك', en: 'New dispute on an order for your shop', icon: 'alert', tone: 'danger' },
  vendor_dispute_escalated: { title: 'صُعِّد نزاع على متجرك للإدارة', en: 'A dispute on your shop was escalated to admin', icon: 'shield', tone: 'warning' },
  vendor_dispute_resolved: { title: 'حُسم نزاع على متجرك', en: 'A dispute on your shop was resolved', icon: 'shield', tone: 'info' },
  vendor_dispute_withdrawn: { title: 'سحب المشتري نزاعه', en: 'The buyer withdrew their dispute', icon: 'check-circle', tone: 'success' },
  return_requested: { title: 'طلب إرجاع جديد', en: 'New return request', icon: 'return', tone: 'warning' },
  payout_paid: { title: 'نُفّذ تحويل رصيدك', en: 'Your payout was paid', icon: 'wallet', tone: 'success' },
  payout_rejected: { title: 'رُفض طلب السحب', en: 'Payout request rejected', icon: 'alert', tone: 'danger' },
  vendor_approved: { title: 'قُبل متجرك', en: 'Your shop was approved', icon: 'store', tone: 'success' },
  vendor_rejected: { title: 'لم يُقبل متجرك', en: "Your shop wasn't approved", icon: 'store', tone: 'danger' },
  vendor_document_rejected: { title: 'رُفضت وثيقة من طلب متجرك', en: 'A document in your shop application was rejected', icon: 'file', tone: 'warning' },
  product_rejected: { title: 'أُعيد منتج إليك للتعديل', en: 'A product was sent back to you for edits', icon: 'alert', tone: 'warning' },
  low_stock: { title: 'مخزون منخفض', en: 'Low stock', icon: 'boxes', tone: 'warning' },
  message_to_customer: { title: 'ردّ من متجر', en: 'Reply from a shop', icon: 'msg', tone: 'brand' },
  message_to_vendor: { title: 'رسالة من مشترٍ', en: 'Message from a buyer', icon: 'msg', tone: 'brand' },
  bank_account_added: { title: 'أُضيف حساب بنكي', en: 'Bank account added', icon: 'shield', tone: 'warning' },
  bank_account_verified: { title: 'وُثّق حساب بنكي', en: 'Bank account verified', icon: 'check-circle', tone: 'success' },
  recovery_code_used: { title: 'استُعمل رمز استعادة', en: 'A recovery code was used', icon: 'shield', tone: 'warning' },
  totp_reset_by_admin: { title: 'أُعيد ضبط التحقّق بخطوتين', en: 'Two-step verification was reset', icon: 'shield', tone: 'danger' },
  totp_rotated: { title: 'رُبط التحقّق بخطوتين بجهاز جديد', en: 'Two-step verification was linked to a new device', icon: 'shield', tone: 'warning' },
};
const FALLBACK = { title: '', en: '', icon: 'bell' as IconName, tone: 'neutral' as Tone };

const PAGE_SIZE = 20;
const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** اليوم · أمس · هذا الأسبوع · أقدم — بتقويم المتصفّح المحلي */
function groupOf(iso: string, now: Date, t: Translate): string {
  const diff = startOfDay(now) - startOfDay(new Date(iso));
  if (diff <= 0) return t('اليوم', 'Today');
  if (diff <= DAY) return t('أمس', 'Yesterday');
  if (diff < 7 * DAY) return t('هذا الأسبوع', 'This week');
  return t('أقدم', 'Older');
}

const clock: Record<Locale, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat(intlLocale('ar'), { timeStyle: 'short' }),
  en: new Intl.DateTimeFormat(intlLocale('en'), { timeStyle: 'short' }),
};

function unreadText(n: number, locale: Locale): string {
  if (locale === 'en') {
    if (n === 0) return 'All notifications read';
    return n === 1 ? '1 unread notification' : `${n} unread notifications`;
  }
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
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  // كل ضغطة «حمّل المزيد»: كم أضافت ومن أي مؤشّر بدأت — «السابق» يُسقطها ويعيد المؤشّر
  const [batches, setBatches] = useState<{ count: number; cursor: string }[]>([]);
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
        setTotal(p.total ?? p.items.length);
        setCursor(p.nextCursor ?? null);
        setBatches([]);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [router, fetchPage]);

  // الرجوع إلى الصفحة يجلب الجديد في أعلاها، ويُبقي ما حُمّل بـ«المزيد» تحته ومؤشّره
  const returned = useReturnTick();
  useEffect(() => {
    if (!returned) return;
    let alive = true;
    fetchPage(null)
      .then((p) => {
        if (!alive) return;
        setUnread(p.unread);
        if (p.total !== undefined) setTotal(p.total);
        setItems((list) => (list ? [...p.items, ...list.filter((x) => !p.items.some((n) => n.id === x.id))] : p.items));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [returned, fetchPage]);

  async function more(): Promise<void> {
    if (!cursor) return;
    setBusy(true);
    try {
      const p = await fetchPage(cursor);
      setItems((list) => [...(list ?? []), ...p.items]);
      setBatches((b) => [...b, { count: p.items.length, cursor }]);
      setUnread(p.unread);
      if (p.total !== undefined) setTotal(p.total);
      setCursor(p.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذّر جلب المزيد.', "Couldn't load more."));
    } finally {
      setBusy(false);
    }
  }

  /** «السابق»: تُسقط آخر صفحة أضافها «حمّل المزيد» ويعود مؤشّرها، فتُجلب من جديد إن طُلبت */
  function less(): void {
    const last = batches.at(-1);
    if (!last) return;
    setItems((list) => (list ?? []).slice(0, Math.max(0, (list ?? []).length - last.count)));
    setBatches((b) => b.slice(0, -1));
    setCursor(last.cursor);
  }

  /** تبديل العرض يبدأ من أول الصفحة — والهيكل يظهر حتى يصل الجديد */
  function show(next: 'all' | 'unread'): void {
    if (next === filter) return;
    setItems(null);
    setError(null);
    setCursor(null);
    setBatches([]);
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
      setStatus(t('عُلّمت كل الإشعارات كمقروءة.', 'All notifications marked as read.'));
      announce();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذّر تعليم الإشعارات.', "Couldn't mark the notifications as read."));
    } finally {
      setBusy(false);
    }
  }

  // في «غير المقروء» يبقى ما قُرئ للتوّ ظاهراً حتى إعادة التحميل — لا يقفز من تحت المؤشّر
  const shown = items ?? [];
  const now = new Date();
  const groups: { label: string; items: Item[] }[] = [];
  for (const n of shown) {
    const label = groupOf(n.createdAt, now, t);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="aa-page">
      <PageHead
        title={t('الإشعارات', 'Notifications')}
        {...(items ? { count: unreadText(unread, locale) } : {})}
        actions={
          <>
            <span className="seg" role="group" aria-label={t('عرض', 'Show')}>
              <button
                type="button"
                className="seg__opt"
                aria-pressed={filter === 'all'}
                onClick={() => show('all')}
              >
                {t('الكل', 'All')}
              </button>
              <button
                type="button"
                className="seg__opt"
                aria-pressed={filter === 'unread'}
                onClick={() => show('unread')}
              >
                {t('غير المقروء', 'Unread')}
              </button>
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || unread === 0}
              onClick={() => void markAll()}
            >
              <Icon name="check" size={15} />
              {t('علّم الكل كمقروء', 'Mark all as read')}
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
          <span className="visually-hidden">{t('جارٍ جلب الإشعارات…', 'Loading notifications…')}</span>
          <span className="skeleton aa-skel__card" aria-hidden />
        </div>
      ) : null}

      {items && items.length === 0 ? (
        filter === 'unread' ? (
          <EmptyState icon="bell" title={t('لا إشعارات غير مقروءة', 'No unread notifications')}>
            {t('قرأتَ كل شيء. بدّل إلى «الكل» لتصفّح السجلّ.', "You've read everything. Switch to “All” to browse the history.")}
          </EmptyState>
        ) : (
          <EmptyState icon="bell" title={t('لا إشعارات بعد', 'No notifications yet')}>
            {t(
              'نخبرك هنا بتغيّر حالة طلباتك وردود المتاجر وقرارات النزاعات.',
              "We'll let you know here when your orders change status, shops reply, or disputes are decided.",
            )}
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
                  const title = t(kind.title, kind.en) || n.body || t('إشعار', 'Notification');
                  const body = kind.title ? n.body : null;
                  const isUnread = !n.readAt;
                  const time =
                    groupOf(n.createdAt, now, t) === t('اليوم', 'Today')
                      ? clock[locale].format(new Date(n.createdAt))
                      : when(n.createdAt, locale);
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
                              <span className="visually-hidden">{t(' — غير مقروء', ' — unread')}</span>
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
          {cursor || batches.length > 0 ? (
            <div className="aa-more">
              <span className="list-more__count num">{t(`${items.length} من ${Math.max(total, items.length)}`, `${items.length} of ${Math.max(total, items.length)}`)}</span>
              {batches.length > 0 ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={less}>
                  {t('السابق', 'Previous')}
                </button>
              ) : null}
              {cursor ? (
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void more()}>
                  {busy ? <span className="spinner" aria-hidden /> : null}
                  {t('حمّل المزيد', 'Load more')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
