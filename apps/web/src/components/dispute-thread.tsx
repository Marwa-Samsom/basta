'use client';

import '@/styles/screens/dispute-thread.css';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, EmptyState, PageHead, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { localized } from '@/lib/i18n';
import {
  DISPUTE_REASONS,
  DISPUTE_REASONS_EN,
  DISPUTE_STATUS,
  DISPUTE_STATUS_EN,
  ROLE_LABEL,
  ROLE_LABEL_EN,
  when,
} from '@/lib/orders';

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
  const t = useT();
  const locale = useLocale();
  const reasons = localized(locale, DISPUTE_REASONS, DISPUTE_REASONS_EN);
  const statuses = localized(locale, DISPUTE_STATUS, DISPUTE_STATUS_EN);
  const roles = localized(locale, ROLE_LABEL, ROLE_LABEL_EN);
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
      {t('رجوع', 'Back')}
    </Link>
  );

  if (!d) {
    return (
      <div className="sp-dispute">
        {backLink}
        {error ? <Alert tone="danger">{error}</Alert> : <Spinner label={t('جارٍ فتح النزاع…', 'Opening dispute…')} />}
      </div>
    );
  }
  const open = d.status === 'open' || d.status === 'escalated';
  const mine = (role: string) => (me === 'customer' ? role === 'customer' : role.startsWith('vendor'));

  return (
    <div className="sp-dispute">
      {backLink}
      <PageHead title={reasons[d.reasonCode] ?? d.reasonCode} meta={t(`فُتح ${when(d.createdAt)}`, `Opened ${when(d.createdAt, locale)}`)} />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {d.status === 'escalated' ? (
        <Alert tone="info">
          {t('النزاع لدى الإدارة الآن. مال هذا الطلب مجمَّد حتى الحسم.', "The dispute is with the admin now. This order's money is frozen until it's resolved.")}
        </Alert>
      ) : null}
      {d.resolution ? <Alert tone="success" title={t('قرار الإدارة', "Admin's decision")}>{d.resolution}</Alert> : null}

      <section className="sp-thread" aria-label={t('رسائل النزاع', 'Dispute messages')}>
        <header className="sp-thread__head">
          <span className="tile-icon sp-tile" aria-hidden>
            <Icon name="store" size={16} />
          </span>
          <span className="sp-thread__who">
            <span className="sp-thread__shop">{d.subOrder.vendor.nameAr}</span>
            <span className="sp-thread__ctx">
              {t('الطلب', 'Order')} <span className="num">{d.subOrder.order.orderNumber}</span> · {t('الشحنة', 'Shipment')}{' '}
              <span className="num">{d.subOrder.subOrderNumber}</span>
            </span>
          </span>
          <span className={`badge ${toneOf(d.status)}`}>{statuses[d.status] ?? d.status}</span>
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
                      <span className="sp-msg__role">{own ? t('أنت', 'You') : roles[m.senderRole] ?? m.senderRole}</span>
                      <span className="sp-msg__time">{when(m.createdAt, locale)}</span>
                    </div>
                    <p className="sp-msg__body">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="sp-thread__list sp-thread__empty">{t('لا رسائل بعد.', 'No messages yet.')}</p>
        )}

        {open ? (
          <div className="sp-composer">
            <label className="visually-hidden" htmlFor={replyId}>
              {t('ردّك', 'Your reply')}
            </label>
            <textarea
              id={replyId}
              className="field__control"
              rows={3}
              placeholder={t('اكتب ردّك…', 'Write your reply…')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="sp-composer__actions">
              {d.status === 'open' ? (
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void act('/escalate')}>
                  <Icon name="shield" size={14} />
                  {t('تصعيد للإدارة', 'Escalate to admin')}
                </button>
              ) : null}
              {me === 'customer' ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act('/withdraw')}>
                  {t('سحب النزاع — حُلّت المشكلة', 'Withdraw dispute — the problem is solved')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--primary sp-composer__send"
                disabled={busy || !body.trim()}
                onClick={() => void act('/messages', { body })}
              >
                <Icon name="send" size={15} mirror />
                {t('إرسال', 'Send')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** قائمة النزاعات — لكلا الجمهورين */
export function DisputeList({ base, link, searchable = false }: { base: string; link: (id: string) => string; searchable?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const reasons = localized(locale, DISPUTE_REASONS, DISPUTE_REASONS_EN);
  const statuses = localized(locale, DISPUTE_STATUS, DISPUTE_STATUS_EN);
  // للبائع: تصفية النزاعات المحمّلة برقم الطلب أو السبب
  const [filter, setFilter] = useState('');
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
      <EmptyState icon="msg" title={t('لا نزاعات', 'No disputes')}>
        {t('حين يُفتح نزاع على طلب يظهر هنا بخيط رسائله وحالته.', 'When a dispute is opened on an order, it shows up here with its message thread and status.')}
      </EmptyState>
    );
  }
  const term = filter.trim();
  const shown = term
    ? rows.filter(
        (r) =>
          r.subOrder.subOrderNumber.toLowerCase().includes(term.toLowerCase()) ||
          (reasons[r.reasonCode] ?? '').toLowerCase().includes(term.toLowerCase()),
      )
    : rows;
  return (
    <>
      {searchable ? (
        <span className="input-icon sp-dlist__search">
          <Icon name="search" size={15} />
          <input
            className="field__control"
            type="search"
            placeholder={t('رقم الطلب أو السبب', 'Order number or reason')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t('صفِّ النزاعات', 'Filter disputes')}
          />
        </span>
      ) : null}
      {shown.length === 0 ? <p className="small muted">{t(`لا نزاع يطابق «${term}».`, `No dispute matches “${term}”.`)}</p> : null}
    <div className="table-wrap sp-dlist">
      <table className="table">
        <thead>
          <tr>
            <th>{t('الطلب', 'Order')}</th>
            <th>{t('السبب', 'Reason')}</th>
            <th>{t('الرسائل', 'Messages')}</th>
            <th>{t('التاريخ', 'Date')}</th>
            <th>{t('الحالة', 'Status')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td data-label={t('الطلب', 'Order')}>
                <span className="stack stack--tight">
                  <Link href={link(r.id)} className="num">
                    {r.subOrder.subOrderNumber}
                  </Link>
                  <span className="sp-dlist__vendor">{r.subOrder.vendor.nameAr}</span>
                </span>
              </td>
              <td data-label={t('السبب', 'Reason')}>{reasons[r.reasonCode] ?? r.reasonCode}</td>
              <td data-label={t('الرسائل', 'Messages')} className="num">
                {r._count.messages}
              </td>
              <td data-label={t('التاريخ', 'Date')} className="small">
                {when(r.createdAt, locale)}
              </td>
              <td data-label={t('الحالة', 'Status')}>
                <span className={`badge ${toneOf(r.status)}`}>{statuses[r.status] ?? r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
