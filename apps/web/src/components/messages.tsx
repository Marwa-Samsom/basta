'use client';

import '@/styles/screens/messages.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { api, session } from '@/lib/api';

type Side = 'customer' | 'vendor';
export type Audience = Side;

interface Context {
  kind: 'product' | 'order' | 'general';
  label: string;
  productSlug?: string;
  orderNumber?: string;
  subOrderNumber?: string;
  subOrderId?: string;
}

interface Row {
  id: string;
  shop: { nameAr: string; slug: string };
  customer?: { fullName: string };
  context: Context;
  lastPreview: string;
  lastMessageAt: string;
  lastSenderSide: Side;
  unread: boolean;
}

interface Message {
  id: string;
  side: Side;
  mine: boolean;
  body: string;
  createdAt: string;
}

interface Thread {
  id: string;
  shop: { nameAr: string; slug: string };
  customer?: { fullName: string };
  context: Context;
  messages: Message[];
}

export const MESSAGE_MAX = 1000;

/**
 * ردود البائع الجاهزة — عامّة تصلح لأي متجر. أمثلة التصميم (القطن المصري،
 * بطاقة الشحن المجاني) كانت بيانات عرض لمتجر بعينه، ووعدٌ لا يملكه كل بائع.
 */
const QUICK_REPLIES = [
  'متوفّر، نشحنه غداً.',
  'شكراً لسؤالك، نتحقّق ونعود إليك اليوم.',
  'هذا المقاس غير متوفّر حالياً، ونخبرك حين يعود.',
  'نعتذر عن التأخير، نتابع مع الناقل الآن.',
];

// ------------------------------------------------------------------ الوقت

const DAY = 86_400_000;
const clock = new Intl.DateTimeFormat('ar-u-nu-latn', { timeStyle: 'short' });
const dayMonth = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long' });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (iso: string) => Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / DAY);

/** في القائمة: الساعة اليوم، «أمس»، ثم اليوم والشهر */
function listTime(iso: string): string {
  const d = daysAgo(iso);
  if (d <= 0) return clock.format(new Date(iso));
  if (d === 1) return 'أمس';
  return dayMonth.format(new Date(iso));
}

/** تحت الرسالة: «14:02» · «أمس · 11:10» · «9 سبتمبر · 10:02» */
function messageTime(iso: string): string {
  const d = daysAgo(iso);
  const t = clock.format(new Date(iso));
  if (d <= 0) return t;
  if (d === 1) return `أمس · ${t}`;
  return `${dayMonth.format(new Date(iso))} · ${t}`;
}

function summary(total: number, unread: number): string {
  if (total === 0) return 'لا محادثات';
  const t = total === 1 ? 'محادثة واحدة' : total === 2 ? 'محادثتان' : total <= 10 ? `${total} محادثات` : `${total} محادثة`;
  return unread ? `${t} · ${unread} غير مقروءة` : t;
}

/** رابط سياق المحادثة: كلٌّ إلى صفحته — طلب المشتري في حسابه، والطلب الفرعي في لوحة البائع */
function contextHref(c: Context, audience: Audience): string | null {
  if (c.kind === 'product' && c.productSlug) return `/p/${encodeURIComponent(c.productSlug)}`;
  if (c.kind === 'order') {
    if (audience === 'customer' && c.orderNumber) return `/account/orders/${encodeURIComponent(c.orderNumber)}`;
    if (audience === 'vendor' && c.subOrderId) return `/vendor/orders/${c.subOrderId}`;
  }
  return null;
}

const WIDE = '(min-width: 761px)';

/**
 * ST-28 «رسائلي» و VD-15 «رسائل البائع» — المكوّن نفسه بجمهورين.
 *
 * قائمة المحادثات بجانب المحادثة المفتوحة ومحرّر الردّ. `?c=<id>` يفتح
 * محادثة بعينها (رابط التنبيه)، وعلى الشاشة العريضة تُفتح الأولى إن لم
 * يُحدَّد شيء. على الجوال القائمة وحدها، ثم الخيط وحده بزرّ رجوع.
 *
 * فتح المحادثة يعلّمها مقروءة في الخادم — ولذلك لا تُفتح الأولى تلقائياً
 * على الجوال: خيط مخفيّ لم يره أحد لا يُعدّ مقروءاً.
 */
export function MessagesInbox({ audience }: { audience: Audience }) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('c');
  const base = audience === 'customer' ? '/me/conversations' : '/vendor/conversations';
  const path = audience === 'customer' ? '/account/messages' : '/vendor/messages';

  const [rows, setRows] = useState<Row[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  // البائع يصفّي محادثاته باسم المشتري أو موضوعها أو آخر رسالة — حتى مئتي محادثة محمّلة
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (audience === 'customer' && !session.read()) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    let alive = true;
    api<{ unread: number; items: Row[] }>(base)
      .then((d) => {
        if (!alive) return;
        setRows(d.items);
        setUnread(d.unread);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [audience, base, router]);

  const term = filter.trim();
  const shown = (rows ?? []).filter(
    (r) => !term || [r.customer?.fullName ?? '', r.context.label, r.lastPreview].some((x) => x.toLowerCase().includes(term.toLowerCase())),
  );
  const activeId = selected ?? (wide ? (shown[0]?.id ?? null) : null);

  /** الخيط أُرسل فيه أو فُتح — القائمة تتبعه بلا إعادة جلب */
  const rowsRef = useRef<Row[] | null>(null);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const onOpened = useCallback((id: string) => {
    if (!rowsRef.current?.find((r) => r.id === id)?.unread) return;
    setUnread((u) => Math.max(0, u - 1));
    setRows((list) => list?.map((r) => (r.id === id ? { ...r, unread: false } : r)) ?? list);
  }, []);

  const onSent = useCallback((id: string, m: Message) => {
    setRows((list) => {
      if (!list) return list;
      const row = list.find((r) => r.id === id);
      if (!row) return list;
      const next: Row = { ...row, lastPreview: m.body.slice(0, 140), lastMessageAt: m.createdAt, lastSenderSide: m.side, unread: false };
      return [next, ...list.filter((r) => r.id !== id)];
    });
  }, []);

  const head =
    audience === 'customer' ? (
      <PageHead title="رسائلي" meta="رسائل غير فورية مع المتاجر — يردّ المتجر عادةً خلال يوم عمل." />
    ) : (
      <PageHead title="الرسائل" {...(rows ? { count: summary(rows.length, unread) } : {})} />
    );

  if (error && !rows) {
    return (
      <div className={audience === 'customer' ? 'ms-page' : 'vm-page ms-page'}>
        {head}
        <Alert tone="danger">{error}</Alert>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className={audience === 'customer' ? 'ms-page' : 'vm-page ms-page'}>
        {head}
        <div className={`ms-layout${audience === 'vendor' ? ' ms-layout--vendor' : ''}`} role="status">
          <span className="visually-hidden">جارٍ جلب المحادثات…</span>
          <span className="skeleton ms-skel__list" aria-hidden />
          <span className="skeleton ms-skel__thread" aria-hidden />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={audience === 'customer' ? 'ms-page' : 'vm-page ms-page'}>
        {head}
        {audience === 'customer' ? (
          <EmptyState icon="msg" title="لا رسائل بعد">
            راسل المتجر من صفحة المنتج أو من تفاصيل الطلب إن احتجت سؤالاً عن مقاس أو شحنة.
          </EmptyState>
        ) : (
          <EmptyState icon="msg" title="لا رسائل">
            أسئلة المشترين عن منتجاتك وطلباتهم تظهر هنا.
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className={audience === 'customer' ? 'ms-page' : 'vm-page ms-page'}>
      {head}
      <div
        className={`ms-layout${audience === 'vendor' ? ' ms-layout--vendor' : ''}`}
        data-view={selected ? 'thread' : 'list'}
      >
        <nav className="ms-panel ms-list" aria-label="المحادثات">
          {audience === 'vendor' ? (
            <div className="ms-list__search">
              <span className="input-icon">
                <Icon name="search" size={15} />
                <input
                  className="field__control"
                  type="search"
                  placeholder="المشتري أو المنتج أو الطلب"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="صفِّ المحادثات"
                />
              </span>
            </div>
          ) : null}
          {shown.length === 0 ? <p className="ms-list__none">لا محادثة تطابق «{filter.trim()}».</p> : null}
          <ul className="ms-list__items">
            {shown.map((r) => {
              const active = r.id === activeId;
              const isUnread = r.unread && !active;
              return (
                <li key={r.id}>
                  <Link
                    href={`${path}?c=${r.id}`}
                    replace
                    scroll={false}
                    className="ms-row"
                    data-unread={isUnread}
                    {...(active ? { 'aria-current': 'true' as const } : {})}
                  >
                    {audience === 'customer' ? (
                      <>
                        <span className="tile-icon ms-row__tile" aria-hidden>
                          <Icon name="store" size={17} />
                        </span>
                        <span className="ms-row__text">
                          <span className="ms-row__top">
                            <span className="ms-row__name">{r.shop.nameAr}</span>
                            {isUnread ? (
                              <>
                                <span className="ms-row__dot" aria-hidden />
                                <span className="visually-hidden"> — غير مقروءة</span>
                              </>
                            ) : null}
                          </span>
                          <span className="ms-row__preview">{r.lastPreview}</span>
                          <time className="ms-row__time" dateTime={r.lastMessageAt}>
                            {listTime(r.lastMessageAt)}
                          </time>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="ms-row__top">
                          <span className="ms-row__initial" aria-hidden>
                            {r.customer?.fullName.trim().charAt(0) ?? '؟'}
                          </span>
                          <span className="ms-row__name">{r.customer?.fullName}</span>
                          {isUnread ? (
                            <>
                              <span className="ms-row__dot" aria-hidden />
                              <span className="visually-hidden"> — غير مقروءة</span>
                            </>
                          ) : null}
                          <time className="ms-row__time" dateTime={r.lastMessageAt}>
                            {listTime(r.lastMessageAt)}
                          </time>
                        </span>
                        <span className="ms-row__about">{r.context.label}</span>
                        <span className="ms-row__preview">{r.lastPreview}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {activeId ? (
          <ThreadPane
            key={activeId}
            id={activeId}
            audience={audience}
            base={base}
            backHref={path}
            onOpened={onOpened}
            onSent={onSent}
          />
        ) : (
          <section className="ms-panel ms-thread" aria-label="المحادثة">
            <p className="ms-thread__note">اختر محادثة من القائمة لتقرأها وتردّ.</p>
          </section>
        )}
      </div>
    </div>
  );
}

function ThreadPane({
  id,
  audience,
  base,
  backHref,
  onOpened,
  onSent,
}: {
  id: string;
  audience: Audience;
  base: string;
  backHref: string;
  onOpened: (id: string) => void;
  onSent: (id: string, m: Message) => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const draftId = useId();
  const countId = useId();
  const titleId = useId();

  useEffect(() => {
    let alive = true;
    api<Thread>(`${base}/${id}`)
      .then((t) => {
        if (!alive) return;
        setThread(t);
        onOpened(id);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [base, id, onOpened]);

  // آخر رسالة ظاهرة عند الفتح وبعد الإرسال
  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  async function send(): Promise<void> {
    const body = draft.trim();
    if (!body) {
      setStatus('اكتب رسالة أولاً.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = await api<Message>(`${base}/${id}/messages`, { method: 'POST', body: { body } });
      setThread((t) => (t ? { ...t, messages: [...t.messages, m] } : t));
      setDraft('');
      onSent(id, m);
      setStatus(audience === 'customer' ? 'أُرسلت رسالتك — يردّ المتجر عادةً خلال يوم عمل.' : 'أُرسل ردّك إلى المشتري.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر إرسال الرسالة.');
    } finally {
      setBusy(false);
    }
  }

  /** Ctrl/⌘ + Enter يرسل — Enter وحده سطر جديد */
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!busy) void send();
    }
  }

  const back = (
    <Link href={backHref} replace scroll={false} className="btn btn--ghost btn--sm ms-thread__back">
      <Icon name="back" size={15} mirror />
      المحادثات
    </Link>
  );

  if (!thread) {
    return (
      <section className="ms-panel ms-thread" aria-label="المحادثة">
        <div className="ms-thread__head">{back}</div>
        {error ? (
          <div className="ms-thread__scroll">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : (
          <div className="ms-thread__scroll" role="status">
            <span className="visually-hidden">جارٍ فتح المحادثة…</span>
            <span className="skeleton ms-skel__thread" aria-hidden />
          </div>
        )}
      </section>
    );
  }

  const href = contextHref(thread.context, audience);
  const mineLabel = audience === 'customer' ? 'أنا' : 'متجر';
  const theirsLabel = audience === 'customer' ? 'المتجر' : 'مشتري';

  return (
    <section className="ms-panel ms-thread" aria-labelledby={titleId}>
      <header className="ms-thread__head">
        {back}
        {audience === 'customer' ? (
          <>
            <span className="tile-icon" aria-hidden>
              <Icon name="store" size={16} />
            </span>
            <span className="ms-thread__who">
              <h2 id={titleId} className="ms-thread__shop">
                {thread.shop.nameAr}
              </h2>
              <span className="ms-thread__ctx">بخصوص {thread.context.label}</span>
            </span>
            {href ? (
              <Link href={href} className="btn btn--secondary btn--sm ms-thread__open">
                {thread.context.kind === 'order' ? 'افتح الطلب' : 'افتح المنتج'}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <h2 id={titleId} className="ms-thread__customer">
              {thread.customer?.fullName}
            </h2>
            {href ? (
              <Link href={href} className="ms-thread__ctx-link">
                {thread.context.label}
              </Link>
            ) : (
              <span className="ms-thread__ctx">{thread.context.label}</span>
            )}
          </>
        )}
      </header>

      <div ref={scroller} className="ms-thread__scroll" tabIndex={0} role="region" aria-label="الرسائل">
        {thread.messages.length ? (
          <ol className="ms-thread__list">
            {thread.messages.map((m) => (
              <li key={m.id} className={`ms-msg${m.mine ? ' ms-msg--mine' : ''}`}>
                <div className="ms-msg__box">
                  <div className="ms-msg__meta">
                    <span className="ms-msg__role">{m.mine ? mineLabel : theirsLabel}</span>
                    <time className="ms-msg__time" dateTime={m.createdAt}>
                      {messageTime(m.createdAt)}
                    </time>
                  </div>
                  <p className="ms-msg__body">{m.body}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ms-thread__note">لا رسائل في هذه المحادثة بعد.</p>
        )}
      </div>

      <div className="ms-composer">
        {audience === 'vendor' ? (
          <ul className="ms-quick" aria-label="ردود جاهزة">
            {QUICK_REPLIES.map((r) => (
              <li key={r}>
                <button type="button" className="ms-chip" title={r} onClick={() => setDraft(r)}>
                  {r}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <label className="visually-hidden" htmlFor={draftId}>
          {audience === 'customer' ? 'رسالتك للمتجر' : 'ردّك على المشتري'}
        </label>
        <textarea
          id={draftId}
          className="field__control"
          rows={2}
          maxLength={MESSAGE_MAX}
          placeholder={audience === 'customer' ? 'اكتب رسالتك للمتجر…' : 'اكتب ردّك…'}
          value={draft}
          aria-describedby={countId}
          onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX))}
          onKeyDown={onKey}
        />
        <div className="ms-composer__bar">
          <span id={countId} className="ms-composer__count num" data-near={draft.length > MESSAGE_MAX - 50}>
            {draft.length} / {MESSAGE_MAX}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm ms-composer__send"
            disabled={busy || !draft.trim()}
            onClick={() => void send()}
          >
            {busy ? <span className="spinner" aria-hidden /> : <Icon name="send" size={15} mirror />}
            أرسل
          </button>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  );
}
