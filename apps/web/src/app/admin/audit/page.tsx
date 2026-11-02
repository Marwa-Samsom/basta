'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Loading, MoreButton, SearchBox, SortButton } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ClearableInput, EmptyState } from '@/components/ui';
import { useAdminList } from '@/lib/admin';
import { localized } from '@/lib/i18n';
import { ROLE_LABEL, ROLE_LABEL_EN, when } from '@/lib/orders';

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

/**
 * أنواع الكيان بأسمائها العربية — الرمز يبقى قيمة التصفية. كانت القائمة رموزاً إنجليزية خاماً
 * وناقصة ستة أنواع يكتبها الخادم (ACFG-086، 31 أكتوبر 2026). كل نوع جديد يُكتب في السجل
 * يُضاف هنا، واختبار audit-labels.spec.ts يفشل إن نُسي.
 */
const ENTITY_LABELS: Record<string, string> = {
  Order: 'طلب',
  SubOrder: 'طلب فرعي',
  Refund: 'استرداد',
  Dispute: 'نزاع',
  Vendor: 'متجر',
  VendorDocument: 'وثيقة متجر',
  VendorBankAccount: 'حساب بنكي لمتجر',
  PayoutRequest: 'طلب سحب',
  Product: 'منتج',
  Attribute: 'خصيصة',
  Review: 'تقييم',
  Coupon: 'كوبون',
  Campaign: 'حملة',
  Banner: 'لافتة',
  CmsPage: 'صفحة محتوى',
  NotificationTemplate: 'قالب إشعار',
  CommissionRule: 'قاعدة عمولة',
  TaxRate: 'ضريبة',
  ExchangeRate: 'سعر صرف',
  ShippingZone: 'منطقة شحن',
  Setting: 'إعداد',
  User: 'مستخدم',
};

const ENTITY_LABELS_EN: Record<string, string> = {
  Order: 'Order',
  SubOrder: 'Shop order',
  Refund: 'Refund',
  Dispute: 'Dispute',
  Vendor: 'Shop',
  VendorDocument: 'Shop document',
  VendorBankAccount: 'Shop bank account',
  PayoutRequest: 'Payout request',
  Product: 'Product',
  Attribute: 'Attribute',
  Review: 'Review',
  Coupon: 'Coupon',
  Campaign: 'Campaign',
  Banner: 'Banner',
  CmsPage: 'Content page',
  NotificationTemplate: 'Notification template',
  CommissionRule: 'Commission rule',
  TaxRate: 'Tax',
  ExchangeRate: 'Exchange rate',
  ShippingZone: 'Shipping zone',
  Setting: 'Setting',
  User: 'User',
};

/**
 * AD-24 — سجل التدقيق. للقراءة وحدها: لا زرّ تعديل ولا حذف في أي مكان،
 * والقاعدة نفسها ترفض ذلك (ADR-005). التفاصيل: القيمة قبل وبعد.
 */
function AuditInner() {
  const t = useT();
  const locale = useLocale();
  const entityLabels = localized(locale, ENTITY_LABELS, ENTITY_LABELS_EN);
  const roleLabel = localized(locale, ROLE_LABEL, ROLE_LABEL_EN);
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
      <AdminHeader
        title={t('سجل التدقيق', 'Audit log')}
        hint={
          data
            ? t(
                `${data.total} سطر${entityId ? ' لهذا الكيان' : ''} — للقراءة فقط`,
                `${data.total} ${data.total === 1 ? 'entry' : 'entries'}${entityId ? ' for this entity' : ''} — read-only`,
              )
            : undefined
        }
      />

      <div className="toolbar">
        <SearchBox value={actor} onChange={setActor} placeholder={t('المنفّذ (بريد أو اسم)', 'Actor (email or name)')} label={t('المنفّذ', 'Actor')} className="ac2-search" />
        <ClearableInput
          className="field__control num ac2-search"
          placeholder={t('الإجراء، مثل payout.', 'Action, e.g. payout.')}
          dir="ltr"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label={t('الإجراء', 'Action')}
        />
        <select className="field__control" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label={t('نوع الكيان', 'Entity type')}>
          <option value="">{t('كل الأنواع', 'All types')}</option>
          {Object.entries(entityLabels).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <SortButton value={sort} onChange={setSort} />
        {filtered ? (
          <span className="toolbar__end">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setActor(''), setAction(''), setEntityType(''))}>
              {t('أزل التصفية', 'Clear filter')}
            </button>
          </span>
        ) : null}
      </div>

      <div className="alert alert--info ac2-callout">
        <Icon name="shield" size={16} />
        <span>
          {t(
            'سجلّ للقراءة فقط — لا يمكن تعديل أي سطر أو حذفه من أي حساب. اضغط سطراً لترى القيمة قبل وبعد.',
            'A read-only log — no account can edit or delete any entry. Click an entry to see the value before and after.',
          )}
        </span>
      </div>

      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <EmptyState icon="shield" title={filtered ? t('لا سجلّات بهذه التصفية', 'No entries match this filter') : t('لا سجلّات بعد', 'No entries yet')}>
          {filtered ? t('جرّب تصفية أخرى أو ابحث بكلمة أخرى.', 'Try another filter or search for another word.') : t('تظهر السطور هنا بمجرّد وجود نشاط.', 'Entries appear here as soon as there is activity.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table ac2-audit">
            <thead>
              <tr>
                <th scope="col">{t('الوقت', 'Time')}</th>
                <th scope="col">{t('المنفّذ', 'Actor')}</th>
                <th scope="col">{t('الإجراء', 'Action')}</th>
                <th scope="col">{t('الكيان', 'Entity')}</th>
                <th scope="col" className="end">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((e) => (
                <Fragment key={e.id}>
                  <tr data-clickable="true" data-tone={open === e.id ? 'selected' : undefined} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className="ac2-muted-cell">{when(e.createdAt, locale)}</td>
                    <td data-label={t('المنفّذ', 'Actor')}>
                      <span className="ac2-cell">
                        <span className="ac2-cell__main">{e.actor?.fullName ?? (e.actorRole ? roleLabel[e.actorRole] : t('النظام', 'System'))}</span>
                        {e.actor?.email ? <span className="ac2-cell__sub num">{e.actor.email}</span> : null}
                      </span>
                    </td>
                    <td className="num ac2-code" data-label={t('الإجراء', 'Action')}>
                      {e.action}
                    </td>
                    <td data-label={t('الكيان', 'Entity')}>
                      <span className="ac2-cell">
                        <span className="small">{entityLabels[e.entityType] ?? e.entityType}</span>
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
                            <span className="ac2-eyebrow">{t('قبل', 'Before')}</span>
                            <pre dir="ltr">{JSON.stringify(e.beforeJson, null, 2) ?? '—'}</pre>
                          </div>
                          <div className="ac2-diff__pane" data-side="after">
                            <span className="ac2-eyebrow">{t('بعد', 'After')}</span>
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
