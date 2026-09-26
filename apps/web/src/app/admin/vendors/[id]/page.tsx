'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api, apiBlob } from '@/lib/api';
import { TONE, useAction, useAdminData, VENDOR_STATUS } from '@/lib/admin';
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
  bank: { holderName: string; iban: string; bankName: string; swift: string | null } | null;
}

const DOC_STATUS: Record<string, string> = { missing: 'لم تُرفع', pending: 'بانتظار المراجعة', accepted: 'مقبولة', rejected: 'مرفوضة' };
const DOC_TONE: Record<string, string> = { missing: 'badge--pending', pending: 'badge--warning', accepted: 'badge--success', rejected: 'badge--danger' };
const docId = (d: Doc) => d.downloadPath?.split('/').pop() ?? null;

/**
 * AD-05 — ملف البائع: وثائقه (تُفتح عبر مسار مصادَق لا رابط عام)، وقراره:
 * اعتماد، رفض بسبب، تعليق بسبب، أو إعادة. كل قرار في سجل التدقيق.
 */
export default function AdminVendorPage({ params }: { params: Promise<{ id: string }> }) {
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
    }, accept ? 'قُبلت الوثيقة.' : 'رُفضت الوثيقة وأُبلغ البائع بالسبب.');

  const post = (path: string, body: unknown, msg: string) =>
    act.run(async () => {
      await api(`/admin/vendors/${id}/${path}`, { method: 'POST', body });
      reload();
    }, msg);

  return (
    <div className="ao-page">
      <Link href="/admin/vendors" className="ao-back">
        <Icon name="back" size={14} mirror />
        المتاجر
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
              {VENDOR_STATUS[v.status] ?? v.status}
            </span>
          </div>
          <div className="ao-profile__meta">
            <span>
              عملة التسوية <strong className="num">{v.settlementCurrency}</strong>
            </span>
            <span className="num">{v.country}</span>
            <span className="num">{v.slug}</span>
          </div>
        </div>
        <div className="ao-profile__actions">
          {v.status === 'in_review' ? (
            <>
              <button type="button" className="btn btn--primary" disabled={act.busy} onClick={() => void post('approve', {}, 'اعتُمد المتجر وأُبلغ صاحبه.')}>
                <Icon name="check" size={16} />
                اعتمد المتجر
              </button>
              <ReasonButton
                label="اطلب تعديلاً"
                min={10}
                disabled={act.busy}
                icon="return"
                presets={['صورة السجل التجاري غير واضحة', 'اسم الحساب البنكي لا يطابق السجل التجاري', 'الوثائق منتهية الصلاحية']}
                onSubmit={(r) => post('reject', { reason: r }, 'رُفض الطلب وأُبلغ البائع بالسبب.')}
              />
            </>
          ) : null}
          {v.status === 'approved' ? (
            <ReasonButton
              label="علّق المتجر"
              min={10}
              icon="lock"
              hint="تختفي منتجاته فوراً. الطلبات القائمة تكتمل وتُصرف مستحقاتها."
              disabled={act.busy}
              onSubmit={(r) => post('suspend', { reason: r }, 'عُلِّق المتجر.')}
            />
          ) : null}
          {v.status === 'suspended' ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void post('reinstate', {}, 'أُعيد المتجر.')}>
              <Icon name="refresh" size={14} />
              إعادة التفعيل
            </button>
          ) : null}
          <Link className="btn btn--ghost btn--sm" href={`/admin/audit?entityId=${v.id}`}>
            <Icon name="history" size={14} />
            سجل هذا البائع
          </Link>
        </div>
      </section>

      <Feedback error={act.error} notice={act.notice} />
      {v.rejectionReason ? (
        <div className="ao-note" data-tone="danger">
          <Icon name="alert" size={16} />
          <span>سبب الرفض السابق: «{v.rejectionReason}»</span>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        label="أقسام ملف المتجر"
        options={[
          { key: 'docs', label: 'المستندات' },
          { key: 'info', label: 'البيانات والبنك' },
        ]}
      />

      {tab === 'docs' ? (
        <div className="ao-docgrid">
          {v.documents.map((d) => (
            <article key={d.type} className="ao-doc" data-state={d.status}>
              <div className="ao-doc__head">
                <h2 className="ao-doc__title">{d.label}</h2>
                <span className={`badge ${DOC_TONE[d.status] ?? TONE[d.status] ?? ''}`}>{DOC_STATUS[d.status] ?? d.status}</span>
                {d.uploadedAt ? <span className="ao-doc__file num">{when(d.uploadedAt)}</span> : null}
              </div>
              {d.uploaded ? (
                <button type="button" className="ao-doc__preview" onClick={() => void open(d)}>
                  <Icon name="file" size={28} />
                  <span className="ao-doc__name">
                    فتح <span className="num">{d.originalName}</span>
                  </span>
                  <span className="ao-doc__zoom" aria-hidden>
                    <Icon name="zoom-in" size={15} />
                  </span>
                </button>
              ) : (
                <div className="ao-doc__preview" data-empty="true">
                  <Icon name="file" size={28} />
                  <span className="ao-doc__name">لم تُرفع بعد</span>
                </div>
              )}
              {d.uploaded && d.status === 'pending' ? (
                <div className="ao-doc__actions">
                  <button type="button" className="btn btn--sm ao-btn--success" disabled={act.busy} onClick={() => void decide(d, true)}>
                    <Icon name="check" size={14} />
                    اقبل
                  </button>
                  <ReasonButton label="ارفض بسبب" disabled={act.busy} onSubmit={(r) => decide(d, false, r)} />
                </div>
              ) : null}
              {d.rejectReason ? (
                <div className="ao-note" data-tone="danger">
                  <Icon name="alert" size={14} />
                  <span>«{d.rejectReason}»</span>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="ao-infogrid">
          <section className="card">
            <h2 className="ao-card-title">بيانات النشاط</h2>
            <dl className="ao-kv">
              <div>
                <dt>الاسم التجاري</dt>
                <dd>{v.nameAr}</dd>
              </div>
              <div>
                <dt>نوع النشاط</dt>
                <dd>{v.businessType ?? '—'}</dd>
              </div>
              <div>
                <dt>البلد</dt>
                <dd className="num">{v.country}</dd>
              </div>
              <div>
                <dt>أُرسل للمراجعة</dt>
                <dd>{when(v.submittedAt)}</dd>
              </div>
              <div>
                <dt>اعتُمد</dt>
                <dd>{when(v.approvedAt)}</dd>
              </div>
            </dl>
          </section>
          <section className="card">
            <h2 className="ao-card-title">الحساب البنكي</h2>
            {v.bank ? (
              <dl className="ao-kv">
                <div>
                  <dt>صاحب الحساب</dt>
                  <dd>{v.bank.holderName}</dd>
                </div>
                <div>
                  <dt>البنك</dt>
                  <dd>{v.bank.bankName}</dd>
                </div>
                <div>
                  <dt>الآيبان</dt>
                  <dd className="num" dir="ltr">
                    {v.bank.iban}
                  </dd>
                </div>
                {v.bank.swift ? (
                  <div>
                    <dt>SWIFT</dt>
                    <dd className="num">{v.bank.swift}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="muted small">لم يُضف بعد.</p>
            )}
          </section>
          <section className="card ao-infogrid__wide">
            <h2 className="ao-card-title">السياسات</h2>
            <p className="ao-prose">{v.descriptionAr ?? '—'}</p>
            <dl className="ao-kv">
              <div>
                <dt>الشحن</dt>
                <dd className="ao-prose">{v.shippingPolicyAr ?? '—'}</dd>
              </div>
              <div>
                <dt>الإرجاع</dt>
                <dd className="ao-prose">{v.returnPolicyAr ?? '—'}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
