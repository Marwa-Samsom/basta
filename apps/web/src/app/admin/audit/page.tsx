'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Loading, MoreButton, SearchBox, SortButton } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ClearableInput, EmptyState } from '@/components/ui';
import { useAdminList } from '@/lib/admin';
import { ROLE_LABEL, when } from '@/lib/orders';

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  ip: string | null;
  createdAt: string;
  actor: { email: string | null; fullName: string | null } | null;
}

const ENTITY_TYPES = ['SubOrder', 'Vendor', 'Product', 'PayoutRequest', 'CommissionRule', 'Setting', 'TaxRate', 'ExchangeRate', 'Coupon', 'User', 'Dispute', 'NotificationTemplate', 'CmsPage', 'Banner', 'Review'];

/**
 * AD-24 — سجل التدقيق. للقراءة وحدها: لا زرّ تعديل ولا حذف في أي مكان،
 * والقاعدة نفسها ترفض ذلك (ADR-005). التفاصيل: القيمة قبل وبعد.
 */
function AuditInner() {
  const params = useSearchParams();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const entityId = params.get('entityId') ?? '';
  const [sort, setSort] = useState<SortOrder>('newest');
  const q = new URLSearchParams({
    sort,
    ...(actor ? { actor } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
  });
  const list = useAdminList<Entry>(`/admin/audit?${q}`, (e) => e.id);
  const { data, error, forbidden } = list;
  const filtered = Boolean(actor || action || entityType);

  return (
    <div className="ac2-page">
      <AdminHeader title="سجل التدقيق" hint={data ? `${data.total} سطر${entityId ? ' لهذا الكيان' : ''} — للقراءة فقط` : undefined} />

      <div className="toolbar">
        <SearchBox value={actor} onChange={setActor} placeholder="المنفّذ (بريد أو اسم)" label="المنفّذ" className="ac2-search" />
        <ClearableInput className="field__control num ac2-search" placeholder="الإجراء، مثل payout." dir="ltr" value={action} onChange={(e) => setAction(e.target.value)} aria-label="الإجراء" />
        <select className="field__control" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="نوع الكيان">
          <option value="">كل الأنواع</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <SortButton value={sort} onChange={setSort} />
        {filtered ? (
          <span className="toolbar__end">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setActor(''), setAction(''), setEntityType(''))}>
              أزل التصفية
            </button>
          </span>
        ) : null}
      </div>

      <div className="alert alert--info ac2-callout">
        <Icon name="shield" size={16} />
        <span>سجلّ للقراءة فقط — لا يمكن تعديل أي سطر أو حذفه من أي حساب. اضغط سطراً لترى القيمة قبل وبعد.</span>
      </div>

      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <EmptyState icon="shield" title={filtered ? 'لا سجلّات بهذه التصفية' : 'لا سجلّات بعد'}>
          {filtered ? 'جرّب تصفية أخرى أو ابحث بكلمة أخرى.' : 'تظهر السطور هنا بمجرّد وجود نشاط.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table ac2-audit">
            <thead>
              <tr>
                <th scope="col">الوقت</th>
                <th scope="col">المنفّذ</th>
                <th scope="col">الإجراء</th>
                <th scope="col">الكيان</th>
                <th scope="col" className="end">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((e) => (
                <Fragment key={e.id}>
                  <tr data-clickable="true" data-tone={open === e.id ? 'selected' : undefined} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className="ac2-muted-cell">{when(e.createdAt)}</td>
                    <td data-label="المنفّذ">
                      <span className="ac2-cell">
                        <span className="ac2-cell__main">{e.actor?.fullName ?? (e.actorRole ? ROLE_LABEL[e.actorRole] : 'النظام')}</span>
                        {e.actor?.email ? <span className="ac2-cell__sub num">{e.actor.email}</span> : null}
                      </span>
                    </td>
                    <td className="num ac2-code" data-label="الإجراء">
                      {e.action}
                    </td>
                    <td data-label="الكيان">
                      <span className="ac2-cell">
                        <span className="small">{e.entityType}</span>
                        {e.entityId ? <span className="ac2-cell__sub num">{e.entityId.slice(0, 12)}</span> : null}
                      </span>
                    </td>
                    <td className="num ac2-faint end" data-label="IP">
                      {e.ip ?? '—'}
                    </td>
                  </tr>
                  {open === e.id ? (
                    <tr className="ac2-expand">
                      <td colSpan={5} data-label="">
                        <div className="ac2-diff">
                          <div className="ac2-diff__pane" data-side="before">
                            <span className="ac2-eyebrow">قبل</span>
                            <pre dir="ltr">{JSON.stringify(e.beforeJson, null, 2) ?? '—'}</pre>
                          </div>
                          <div className="ac2-diff__pane" data-side="after">
                            <span className="ac2-eyebrow">بعد</span>
                            <pre dir="ltr">{JSON.stringify(e.afterJson, null, 2) ?? '—'}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton list={list} />
    </div>
  );
}

export default function AdminAuditPage() {
  return (
    <Suspense>
      <AuditInner />
    </Suspense>
  );
}
