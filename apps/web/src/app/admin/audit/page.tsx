'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Loading, MoreButton, SearchBox, SortButton } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ClearableInput, EmptyState } from '@/components/ui';
import { useAdminList } from '@/lib/admin';
import { ROLE_LABEL, STATUS_LABEL, type SubOrderStatus, when } from '@/lib/orders';

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

function actionLabel(code: string): string {
  if (code.startsWith('sub_order.')) {
    const status = STATUS_LABEL[code.slice('sub_order.'.length) as SubOrderStatus];
    if (status) return `طلب فرعي: ${status}`;
  }
  return ACTION_LABELS[code] ?? code;
}

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
          {Object.entries(ENTITY_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
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
                    <td data-label="الإجراء">
                      <span className="ac2-cell">
                        <span className="ac2-cell__main">{actionLabel(e.action)}</span>
                        <span className="ac2-cell__sub num" dir="ltr">
                          {e.action}
                        </span>
                      </span>
                    </td>
                    <td data-label="الكيان">
                      <span className="ac2-cell">
                        <span className="small">{ENTITY_LABELS[e.entityType] ?? e.entityType}</span>
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
