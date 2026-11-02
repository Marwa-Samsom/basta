'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api, apiBlob } from '@/lib/api';
import { useLocale, useT } from '@/components/locale';
import { localized } from '@/lib/i18n';
import { TONE, useAction, useAdminData, VENDOR_STATUS, VENDOR_STATUS_EN } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Doc {
  type: string;
  label: string;
  uploaded: boolean;
  status: string;
  rejectReason: string | null;
  originalName: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  downloadPath: string | null;
}

interface Vendor {
  id: string;
  slug: string;
  nameAr: string;
  country: string;
  businessType: string | null;
  status: string;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  settlementCurrency: string;
  descriptionAr: string | null;
  shippingPolicyAr: string | null;
  returnPolicyAr: string | null;
  documents: Doc[];
}

const DOC_STATUS: Record<string, string> = { missing: 'لم تُرفع', pending: 'بانتظار المراجعة', accepted: 'مقبولة', rejected: 'مرفوضة' };
const DOC_STATUS_EN: Record<string, string> = { missing: 'Not uploaded', pending: 'Awaiting review', accepted: 'Accepted', rejected: 'Rejected' };
/** أسماء الوثائق بالإنجليزية — الخادم يرسل الاسم بالعربية وحدها، فيُقرأ بالنوع */
const DOC_LABEL_EN: Record<string, string> = {
  commercial_register: 'Commercial register',
  national_id: 'National ID',
  tax_card: 'Tax certificate',
  bank_proof: 'Bank account proof',
};
const DOC_TONE: Record<string, string> = { missing: 'badge--pending', pending: 'badge--warning', accepted: 'badge--success', rejected: 'badge--danger' };
const docId = (d: Doc) => d.downloadPath?.split('/').pop() ?? null;

/**
 * AD-05 — ملف البائع: وثائقه (تُفتح عبر مسار مصادَق لا رابط عام)، وقراره:
 * اعتماد، رفض بسبب، تعليق بسبب، أو إعادة. كل قرار في سجل التدقيق.
 */
export default function AdminVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const locale = useLocale();
  const { id } = use(params);
  const { data: v, error, forbidden, reload } = useAdminData<Vendor>(`/admin/vendors/${id}`);
  const act = useAction();
  const [tab, setTab] = useState('docs');

  if (!v) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const open = async (d: Doc) => {
    const docIdValue = docId(d);
    if (!docIdValue) return;
    await act.run(async () => {
      const blob = await apiBlob(`/admin/vendors/${id}/documents/${docIdValue}`);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    });
  };

  const decide = (d: Doc, accept: boolean, reason?: string) =>
    act.run(async () => {
      await api(`/admin/vendors/${id}/documents/${docId(d)}/decision`, { method: 'POST', body: { accept, ...(reason ? { reason } : {}) } });
      reload();
    }, accept ? t('قُبلت الوثيقة.', 'Document accepted.') : t('رُفضت الوثيقة وأُبلغ البائع بالسبب.', 'Document rejected and the seller told the reason.'));

  const post = (path: string, body: unknown, msg: string) =>
    act.run(async () => {
      await api(`/admin/vendors/${id}/${path}`, { method: 'POST', body });
      reload();
    }, msg);

  return (
    <div className="ao-page">
      <Link href="/admin/vendors" className="ao-back">
        <Icon name="back" size={14} mirror />
        {t('المتاجر', 'Shops')}
      </Link>

      <section className="ao-profile">
        <span className="ao-profile__tile" aria-hidden>
          <Icon name="store" size={26} />
        </span>
        <div className="ao-profile__text">
          <div className="ao-profile__title">
            <h1 className="ao-profile__name">{v.nameAr}</h1>
            <span className={`badge ${TONE[v.status] ?? ''}`}>
              <span className="dot" aria-hidden />
              {localized(locale, VENDOR_STATUS, VENDOR_STATUS_EN)[v.status] ?? v.status}
            </span>
          </div>
          <div className="ao-profile__meta">
            <span>
              {t('عملة التسوية', 'Settlement currency')} <strong className="num">{v.settlementCurrency}</strong>
            </span>
            <span className="num">{v.country}</span>
            <span className="num">{v.slug}</span>
          </div>
        </div>
        <div className="ao-profile__actions">
          {v.status === 'in_review' ? (
            <>
              <button type="button" className="btn btn--primary" disabled={act.busy} onClick={() => void post('approve', {}, t('اعتُمد المتجر وأُبلغ صاحبه.', 'Shop approved and its owner notified.'))}>
                <Icon name="check" size={16} />
                {t('اعتمد المتجر', 'Approve shop')}
              </button>
              <ReasonButton
                label={t('اطلب تعديلاً', 'Request changes')}
                min={10}
                disabled={act.busy}
                icon="return"
                presets={[
                  t('صورة السجل التجاري غير واضحة', 'The commercial register image is unclear'),
                  t('اسم الحساب البنكي لا يطابق السجل التجاري', 'The bank account name does not match the commercial register'),
                  t('الوثائق منتهية الصلاحية', 'The documents have expired'),
                ]}
                onSubmit={(r) => post('reject', { reason: r }, t('رُفض الطلب وأُبلغ البائع بالسبب.', 'Request rejected and the seller told the reason.'))}
              />
            </>
          ) : null}
          {v.status === 'approved' ? (
            <ReasonButton
              label={t('علّق المتجر', 'Suspend shop')}
              min={10}
              icon="lock"
              hint={t(
                'تختفي منتجاته فوراً. الطلبات القائمة تكتمل، ورصيده يُسحب بعد حجز احترازي من التعليق (90 يوماً — من الإعدادات).',
                'Its products disappear at once. Open orders are completed, and its balance can be withdrawn after a precautionary hold from the suspension (90 days — from settings).',
              )}
              disabled={act.busy}
              onSubmit={(r) => post('suspend', { reason: r }, t('عُلِّق المتجر.', 'Shop suspended.'))}
            />
          ) : null}
          {v.status === 'suspended' ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void post('reinstate', {}, t('أُعيد المتجر.', 'Shop reinstated.'))}>
              <Icon name="refresh" size={14} />
              {t('إعادة التفعيل', 'Reinstate')}
            </button>
          ) : null}
          <Link className="btn btn--ghost btn--sm" href={`/admin/audit?entityId=${v.id}`}>
            <Icon name="history" size={14} />
            {t('سجل هذا البائع', "This seller's log")}
          </Link>
        </div>
      </section>

      <Feedback error={act.error} notice={act.notice} />
      {v.rejectionReason ? (
        <div className="ao-note" data-tone="danger">
          <Icon name="alert" size={16} />
          <span>
            {t('سبب الرفض السابق: «', 'Previous rejection reason: “')}
            {v.rejectionReason}
            {t('»', '”')}
          </span>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        label={t('أقسام ملف المتجر', 'Shop profile sections')}
        options={[
          { key: 'docs', label: t('المستندات', 'Documents') },
          { key: 'info', label: t('البيانات والبنك', 'Details and bank') },
        ]}
      />

      {tab === 'docs' ? (
        <div className="ao-docgrid">
          {v.documents.map((d) => (
            <article key={d.type} className="ao-doc" data-state={d.status}>
              <div className="ao-doc__head">
                <h2 className="ao-doc__title">{locale === 'en' ? (DOC_LABEL_EN[d.type] ?? d.label) : d.label}</h2>
                <span className={`badge ${DOC_TONE[d.status] ?? TONE[d.status] ?? ''}`}>{localized(locale, DOC_STATUS, DOC_STATUS_EN)[d.status] ?? d.status}</span>
                {d.uploadedAt ? <span className="ao-doc__file">{when(d.uploadedAt, locale)}</span> : null}
              </div>
              {d.uploaded ? (
                <button type="button" className="ao-doc__preview" onClick={() => void open(d)}>
                  <Icon name="file" size={28} />
                  <span className="ao-doc__name">
                    {t('فتح', 'Open')} <span className="num">{d.originalName}</span>
                  </span>
                  <span className="ao-doc__zoom" aria-hidden>
                    <Icon name="zoom-in" size={15} />
                  </span>
                </button>
              ) : (
                <div className="ao-doc__preview" data-empty="true">
                  <Icon name="file" size={28} />
                  <span className="ao-doc__name">{t('لم تُرفع بعد', 'Not uploaded yet')}</span>
                </div>
              )}
              {d.uploaded && d.status === 'pending' ? (
                <div className="ao-doc__actions">
                  <button type="button" className="btn btn--sm ao-btn--success" disabled={act.busy} onClick={() => void decide(d, true)}>
                    <Icon name="check" size={14} />
                    {t('اقبل', 'Accept')}
                  </button>
                  <ReasonButton label={t('ارفض بسبب', 'Reject with a reason')} disabled={act.busy} onSubmit={(r) => decide(d, false, r)} />
                </div>
              ) : null}
              {d.rejectReason ? (
                <div className="ao-note" data-tone="danger">
                  <Icon name="alert" size={14} />
                  <span>
                    {t('«', '“')}
                    {d.rejectReason}
                    {t('»', '”')}
                  </span>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="ao-infogrid">
          <section className="card">
            <h2 className="ao-card-title">{t('بيانات النشاط', 'Business details')}</h2>
            <dl className="ao-kv">
              <div>
                <dt>{t('الاسم التجاري', 'Trade name')}</dt>
                <dd>{v.nameAr}</dd>
              </div>
              <div>
                <dt>{t('نوع النشاط', 'Business type')}</dt>
                <dd>{v.businessType ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('البلد', 'Country')}</dt>
                <dd className="num">{v.country}</dd>
              </div>
              <div>
                <dt>{t('أُرسل للمراجعة', 'Submitted for review')}</dt>
                <dd>{when(v.submittedAt, locale)}</dd>
              </div>
              <div>
                <dt>{t('اعتُمد', 'Approved')}</dt>
                <dd>{when(v.approvedAt, locale)}</dd>
              </div>
            </dl>
          </section>
          <BankAccounts vendorId={id} />
          <section className="card ao-infogrid__wide">
            <h2 className="ao-card-title">{t('السياسات', 'Policies')}</h2>
            <p className="ao-prose">{v.descriptionAr ?? '—'}</p>
            <dl className="ao-kv">
              <div>
                <dt>{t('الشحن', 'Shipping')}</dt>
                <dd className="ao-prose">{v.shippingPolicyAr ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('الإرجاع', 'Returns')}</dt>
                <dd className="ao-prose">{v.returnPolicyAr ?? '—'}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

interface Bank {
  id: string;
  holderName: string;
  bankName: string;
  iban: string;
  swift: string | null;
  isDefault: boolean;
  verified: boolean;
  createdAt: string;
}

/**
 * الحسابات البنكية الحيّة. حساب التسجيل يوثّقه الاعتماد نفسه؛ ما أضافه البائع
 * بعده (VD-20) لا يُحوَّل إليه شيء قبل أن يطابقه المراجع هنا — الآيبان كاملاً
 * واسم صاحبه مقابل اسم النشاط.
 */
function BankAccounts({ vendorId }: { vendorId: string }) {
  const t = useT();
  const locale = useLocale();
  const { data, error, reload } = useAdminData<{ items: Bank[] }>(`/admin/vendors/${vendorId}/bank-accounts`);
  const act = useAction();
  return (
    <section className="card">
      <h2 className="ao-card-title">{t('الحسابات البنكية', 'Bank accounts')}</h2>
      <Feedback error={act.error} notice={act.notice} />
      {!data ? (
        <Loading error={error} inline />
      ) : data.items.length === 0 ? (
        <p className="muted small">{t('لم يُضف بعد.', 'None added yet.')}</p>
      ) : (
        data.items.map((b) => (
          <dl key={b.id} className="ao-kv">
            <div>
              <dt>{t('البنك', 'Bank')}</dt>
              <dd>
                {b.bankName}{' '}
                {b.isDefault ? <span className="badge badge--brand">{t('الافتراضي', 'Default')}</span> : null}{' '}
                <span className={`badge ${b.verified ? 'badge--success' : 'badge--warning'}`}>{b.verified ? t('موثّق', 'Verified') : t('قيد التوثيق', 'Pending verification')}</span>
              </dd>
            </div>
            <div>
              <dt>{t('صاحب الحساب', 'Account holder')}</dt>
              <dd>{b.holderName}</dd>
            </div>
            <div>
              <dt>{t('الآيبان', 'IBAN')}</dt>
              <dd className="num" dir="ltr">
                {b.iban}
              </dd>
            </div>
            {b.swift ? (
              <div>
                <dt>SWIFT</dt>
                <dd className="num">{b.swift}</dd>
              </div>
            ) : null}
            {b.verified ? null : (
              <div>
                <dt>{t('أُضيف', 'Added')}</dt>
                <dd>
                  {when(b.createdAt, locale)}{' '}
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={act.busy}
                    onClick={() =>
                      void act.run(async () => {
                        await api(`/admin/vendors/${vendorId}/bank-accounts/${b.id}/verify`, { method: 'POST' });
                        reload();
                      }, t('وُثّق الحساب وأُبلغ البائع.', 'Account verified and the seller notified.'))
                    }
                  >
                    <Icon name="check" size={14} />
                    {t('وثّق — الاسم يطابق النشاط', 'Verify — the name matches the business')}
                  </button>
                </dd>
              </div>
            )}
          </dl>
        ))
      )}
    </section>
  );
}
