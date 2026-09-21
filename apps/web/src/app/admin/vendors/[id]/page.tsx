'use client';

import Link from 'next/link';
import { use } from 'react';
import { AdminHeader, Feedback, Loading, ReasonButton } from '@/components/admin';
import { Card } from '@/components/ui';
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
const docId = (d: Doc) => d.downloadPath?.split('/').pop() ?? null;

/**
 * AD-05 — ملف البائع: وثائقه (تُفتح عبر مسار مصادَق لا رابط عام)، وقراره:
 * اعتماد، رفض بسبب، تعليق بسبب، أو إعادة. كل قرار في سجل التدقيق.
 */
export default function AdminVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: v, error, forbidden, reload } = useAdminData<Vendor>(`/admin/vendors/${id}`);
  const act = useAction();

  if (!v) return <Loading error={error} forbidden={forbidden} />;

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
    <div className="stack stack--loose">
      <Link href="/admin/vendors" className="small">
        → البائعون
      </Link>
      <AdminHeader title={v.nameAr} hint={`${v.country} · عملة التسوية ${v.settlementCurrency} · ${v.slug}`}>
        <span className={`badge ${TONE[v.status] ?? ''}`}>{VENDOR_STATUS[v.status] ?? v.status}</span>
      </AdminHeader>
      <Feedback error={act.error} notice={act.notice} />
      {v.rejectionReason ? <p className="small muted">سبب الرفض السابق: «{v.rejectionReason}»</p> : null}

      <Card title="القرار">
        <div className="row">
          {v.status === 'in_review' ? (
            <>
              <button type="button" className="btn btn--primary btn--sm" disabled={act.busy} onClick={() => void post('approve', {}, 'اعتُمد المتجر وأُبلغ صاحبه.')}>
                اعتماد
              </button>
              <ReasonButton label="رفض" min={10} disabled={act.busy} presets={['صورة السجل التجاري غير واضحة', 'اسم الحساب البنكي لا يطابق السجل التجاري', 'الوثائق منتهية الصلاحية']} onSubmit={(r) => post('reject', { reason: r }, 'رُفض الطلب وأُبلغ البائع بالسبب.')} />
            </>
          ) : null}
          {v.status === 'approved' ? (
            <ReasonButton
              label="تعليق المتجر"
              min={10}
              hint="تختفي منتجاته فوراً. الطلبات القائمة تكتمل وتُصرف مستحقاتها."
              disabled={act.busy}
              onSubmit={(r) => post('suspend', { reason: r }, 'عُلِّق المتجر.')}
            />
          ) : null}
          {v.status === 'suspended' ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void post('reinstate', {}, 'أُعيد المتجر.')}>
              إعادة التفعيل
            </button>
          ) : null}
          <Link className="btn btn--ghost btn--sm" href={`/admin/audit?entityId=${v.id}`}>
            سجل هذا البائع
          </Link>
        </div>
      </Card>

      <Card title="الوثائق">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الوثيقة</th>
                <th>الملف</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {v.documents.map((d) => (
                <tr key={d.type}>
                  <td>{d.label}</td>
                  <td className="small">
                    {d.uploaded ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void open(d)}>
                        فتح {d.originalName}
                      </button>
                    ) : (
                      '—'
                    )}
                    {d.uploadedAt ? <div className="muted">{when(d.uploadedAt)}</div> : null}
                  </td>
                  <td>
                    <span className={`badge ${TONE[d.status] ?? ''}`}>{DOC_STATUS[d.status] ?? d.status}</span>
                    {d.rejectReason ? <div className="small muted">«{d.rejectReason}»</div> : null}
                  </td>
                  <td>
                    {d.uploaded && d.status === 'pending' ? (
                      <div className="row">
                        <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void decide(d, true)}>
                          قبول
                        </button>
                        <ReasonButton label="رفض" disabled={act.busy} onSubmit={(r) => decide(d, false, r)} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="الحساب البنكي">
          {v.bank ? (
            <dl className="stack stack--tight small">
              <div>صاحب الحساب: {v.bank.holderName}</div>
              <div>البنك: {v.bank.bankName}</div>
              <div className="num" dir="ltr">
                {v.bank.iban}
              </div>
            </dl>
          ) : (
            <p className="muted">لم يُضف بعد.</p>
          )}
        </Card>
        <Card title="السياسات">
          <p className="small">{v.descriptionAr ?? '—'}</p>
          <p className="small muted">الشحن: {v.shippingPolicyAr ?? '—'}</p>
          <p className="small muted">الإرجاع: {v.returnPolicyAr ?? '—'}</p>
        </Card>
      </div>
    </div>
  );
}
