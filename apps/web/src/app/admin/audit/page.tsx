'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Loading, MoreButton, SearchBox, SortButton } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ClearableInput, EmptyState } from '@/components/ui';
import { useAdminList } from '@/lib/admin';
import { localized, type Locale } from '@/lib/i18n';
import { ROLE_LABEL, ROLE_LABEL_EN, labelOf, when } from '@/lib/orders';

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
 * الإجراءات بأسمائها العربية — الرمز يبقى تحته صغيراً لأن خانة «الإجراء» تبحث به. كانت عمود
 * الإجراء رموزاً إنجليزية خاماً (product.reject بدل «إيقاف منتج»). كل إجراء جديد يكتبه الخادم
 * يُضاف هنا، واختبار audit-labels.spec.ts يفشل إن نُسي. انتقالات الطلب الفرعي (`sub_order.<حالة>`)
 * تأخذ اسم حالتها من STATUS_LABEL فلا تُكرَّر.
 */
const ACTION_LABELS: Record<string, string> = {
  'admin.bootstrap': 'منح إدارة من الطرفية',
  'admin.grant': 'منح صلاحية إدارة',
  'admin.ownership_transferred': 'نقل ملكية المنصة',
  'admin.permissions': 'تعديل صلاحيات مدير',
  'admin.revoke': 'سحب الإدارة',
  'admin.totp_recovered': 'استعادة تحقق مدير من الطرفية',
  'attribute.archive': 'أرشفة خصيصة',
  'attribute.create': 'إضافة خصيصة',
  'attribute.delete': 'حذف خصيصة',
  'attribute.restore': 'استرجاع خصيصة',
  'attribute.update': 'تعديل خصيصة',
  'attribute.value_add': 'إضافة قيمة لخصيصة',
  'attribute.value_delete': 'حذف قيمة خصيصة',
  'attribute.value_update': 'تصحيح قيمة خصيصة',
  'auth.login': 'دخول',
  'auth.login_failed': 'محاولة دخول فاشلة',
  'auth.logout_all': 'خروج من كل الأجهزة',
  'auth.password_change_failed': 'محاولة فاشلة لتغيير كلمة المرور',
  'auth.password_changed': 'تغيير كلمة المرور',
  'auth.password_reset': 'إعادة ضبط كلمة المرور',
  'auth.password_reset_requested': 'طلب إعادة ضبط كلمة المرور',
  'auth.recovery_code_used': 'دخول برمز استعادة',
  'auth.recovery_codes_regenerated': 'رموز استعادة جديدة',
  'auth.session_revoked': 'إنهاء جلسة',
  'auth.sessions_revoked_others': 'إنهاء الجلسات الأخرى',
  'auth.totp_disabled': 'إيقاف التحقق الثنائي',
  'auth.totp_enabled': 'تفعيل التحقق الثنائي',
  'auth.totp_rotated': 'تغيير جهاز التحقق الثنائي',
  'banner.save': 'حفظ لافتة',
  'banner.move': 'ترتيب لافتة',
  'campaign.create': 'إنشاء حملة',
  'campaign.pause': 'إيقاف حملة مؤقتاً',
  'campaign.products': 'تعديل منتجات حملة',
  'campaign.resume': 'استئناف حملة',
  'campaign.update': 'تعديل حملة',
  'commission.end': 'إنهاء قاعدة عمولة',
  'commission.set': 'ضبط عمولة',
  'coupon.create': 'إنشاء كوبون',
  'coupon.update': 'تعديل كوبون',
  'customer.reinstate': 'إعادة تفعيل عميل',
  'customer.suspend': 'تعليق عميل',
  'customer.totp_reset': 'إعادة ضبط تحقق عميل',
  'dispute.escalate': 'تصعيد نزاع',
  'dispute.open': 'فتح نزاع',
  'dispute.resolve': 'حسم نزاع',
  'fx.add': 'إضافة سعر صرف',
  'notification_template.review': 'مراجعة قالب إشعار',
  'notification_template.save': 'حفظ قالب إشعار',
  'page.save': 'حفظ صفحة محتوى',
  'payment.late_capture': 'تحصيل دفعة متأخر',
  'payment.late_capture_refunded': 'ردّ دفعة حُصّلت متأخرة',
  'payment.transfer_confirmed': 'تأكيد استلام تحويل',
  'payout.approve': 'اعتماد طلب سحب',
  'payout.paid': 'صرف طلب سحب',
  'payout.reject': 'رفض طلب سحب',
  'payout.request': 'طلب سحب',
  'product.reject': 'إيقاف منتج',
  'refund.transfer_recorded': 'تسجيل تحويل استرداد',
  'review.published': 'نشر تقييم',
  'review.rejected': 'إخفاء تقييم',
  'setting.update': 'تعديل إعداد',
  'shipping_rate.create': 'إضافة سعر شحن',
  'shipping_rate.update': 'تعديل سعر شحن',
  'shipping_zone.create': 'إضافة منطقة شحن',
  'shipping_zone.delete': 'حذف منطقة شحن',
  'shipping_zone.update': 'تعديل منطقة شحن',
  'storefront.featured': 'تعديل المختارات',
  'tax.set': 'ضبط ضريبة',
  'user.email_verification_requested': 'طلب تأكيد البريد',
  'user.email_verified': 'تأكيد البريد',
  'user.profile_update': 'تعديل الملف الشخصي',
  'user.register': 'تسجيل حساب',
  'vendor.apply': 'طلب فتح متجر',
  'vendor.approve': 'اعتماد متجر',
  'vendor.bank_account_add': 'إضافة حساب بنكي',
  'vendor.bank_account_archive': 'أرشفة حساب بنكي',
  'vendor.bank_account_default': 'تعيين الحساب البنكي الافتراضي',
  'vendor.bank_account_verify': 'توثيق حساب بنكي',
  'vendor.document.accept': 'قبول وثيقة متجر',
  'vendor.document.reject': 'رفض وثيقة متجر',
  'vendor.reinstate': 'إعادة تفعيل متجر',
  'vendor.reject': 'رفض متجر',
  'vendor.submit': 'إرسال المتجر للمراجعة',
  'vendor.suspend': 'تعليق متجر',
};

const ACTION_LABELS_EN: Record<string, string> = {
  'admin.bootstrap': 'Admin granted from terminal',
  'admin.grant': 'Admin access granted',
  'admin.ownership_transferred': 'Platform ownership transferred',
  'admin.permissions': 'Admin permissions edited',
  'admin.revoke': 'Admin access revoked',
  'admin.totp_recovered': 'Admin verification recovered from terminal',
  'attribute.archive': 'Attribute archived',
  'attribute.create': 'Attribute added',
  'attribute.delete': 'Attribute deleted',
  'attribute.restore': 'Attribute restored',
  'attribute.update': 'Attribute edited',
  'attribute.value_add': 'Attribute value added',
  'attribute.value_delete': 'Attribute value deleted',
  'attribute.value_update': 'Attribute value corrected',
  'auth.login': 'Sign-in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.logout_all': 'Signed out of all devices',
  'auth.password_change_failed': 'Failed password change attempt',
  'auth.password_changed': 'Password changed',
  'auth.password_reset': 'Password reset',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.recovery_code_used': 'Signed in with a recovery code',
  'auth.recovery_codes_regenerated': 'New recovery codes',
  'auth.session_revoked': 'Session ended',
  'auth.sessions_revoked_others': 'Other sessions ended',
  'auth.totp_disabled': 'Two-step verification turned off',
  'auth.totp_enabled': 'Two-step verification turned on',
  'auth.totp_rotated': 'Two-step verification device changed',
  'banner.save': 'Banner saved',
  'banner.move': 'Banner reordered',
  'campaign.create': 'Campaign created',
  'campaign.pause': 'Campaign paused',
  'campaign.products': 'Campaign products edited',
  'campaign.resume': 'Campaign resumed',
  'campaign.update': 'Campaign edited',
  'commission.end': 'Commission rule ended',
  'commission.set': 'Commission set',
  'coupon.create': 'Coupon created',
  'coupon.update': 'Coupon edited',
  'customer.reinstate': 'Customer reinstated',
  'customer.suspend': 'Customer suspended',
  'customer.totp_reset': 'Customer verification reset',
  'dispute.escalate': 'Dispute escalated',
  'dispute.open': 'Dispute opened',
  'dispute.resolve': 'Dispute resolved',
  'fx.add': 'Exchange rate added',
  'notification_template.review': 'Notification template reviewed',
  'notification_template.save': 'Notification template saved',
  'page.save': 'Content page saved',
  'payment.late_capture': 'Late payment capture',
  'payment.late_capture_refunded': 'Late-captured payment refunded',
  'payment.transfer_confirmed': 'Transfer receipt confirmed',
  'payout.approve': 'Payout request approved',
  'payout.paid': 'Payout request paid',
  'payout.reject': 'Payout request rejected',
  'payout.request': 'Payout requested',
  'product.reject': 'Product stopped',
  'refund.transfer_recorded': 'Refund transfer recorded',
  'review.published': 'Review published',
  'review.rejected': 'Review hidden',
  'setting.update': 'Setting edited',
  'shipping_rate.create': 'Shipping rate added',
  'shipping_rate.update': 'Shipping rate edited',
  'shipping_zone.create': 'Shipping zone added',
  'shipping_zone.delete': 'Shipping zone deleted',
  'shipping_zone.update': 'Shipping zone edited',
  'storefront.featured': 'Featured picks edited',
  'tax.set': 'Tax set',
  'user.email_verification_requested': 'Email confirmation requested',
  'user.email_verified': 'Email confirmed',
  'user.profile_update': 'Profile edited',
  'user.register': 'Account registered',
  'vendor.apply': 'Shop application',
  'vendor.approve': 'Shop approved',
  'vendor.bank_account_add': 'Bank account added',
  'vendor.bank_account_archive': 'Bank account archived',
  'vendor.bank_account_default': 'Default bank account set',
  'vendor.bank_account_verify': 'Bank account verified',
  'vendor.document.accept': 'Shop document accepted',
  'vendor.document.reject': 'Shop document rejected',
  'vendor.reinstate': 'Shop reinstated',
  'vendor.reject': 'Shop rejected',
  'vendor.submit': 'Shop submitted for review',
  'vendor.suspend': 'Shop suspended',
};

function actionLabel(code: string, locale: Locale): string {
  if (code.startsWith('sub_order.')) {
    const to = code.slice('sub_order.'.length);
    const status = labelOf(to, locale);
    if (status !== to) return locale === 'en' ? `Sub-order: ${status}` : `طلب فرعي: ${status}`;
  }
  return localized(locale, ACTION_LABELS, ACTION_LABELS_EN)[code] ?? code;
}

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
                    <td data-label={t('الإجراء', 'Action')}>
                      <span className="ac2-cell">
                        <span className="ac2-cell__main">{actionLabel(e.action, locale)}</span>
                        <span className="ac2-cell__sub num" dir="ltr">
                          {e.action}
                        </span>
                      </span>
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
