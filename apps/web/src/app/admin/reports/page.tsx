'use client';

import { useState } from 'react';
import { AdminHeader, Loading } from '@/components/admin';
import { Alert, Card } from '@/components/ui';
import { apiBlob } from '@/lib/api';
import { downloadName, useAdminData } from '@/lib/admin';
import { money } from '@/lib/orders';

interface Report {
  sales: { currency: string; orders: number; grossMinorUnits: string; refundedMinorUnits: string; averageOrderMinorUnits: string; fxSpreadMinorUnits: string }[];
  ledger: {
    currency: string;
    commissionMinorUnits: string;
    taxHeldMinorUnits: string;
    discountSubsidyMinorUnits: string;
    roundingMinorUnits: string;
    platformNetMinorUnits: string;
    vendorSalesMinorUnits: string;
    vendorRefundsMinorUnits: string;
    vendorDuesNetMinorUnits: string;
    payoutsPaidMinorUnits: string;
  }[];
  activeVendors: number;
  conversion: { carts: number; paidOrders: number; ratePct: number | null };
  usd: { note: string; rows: { metric: string; currency: string; rate: number | null; usd: string | null }[] };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * AD-25 — التقارير. كل رقم مالي من الدفتر نفسه (بوابة 11 البند 2)، مجمّعاً
 * بالعملة. الموحَّد بالدولار عرضٌ يذكر سعره بجانب كل رقم.
 */
export default function AdminReportsPage() {
  // الافتراضي آخر 30 يوماً — مهيّأ مرة واحدة لا في كل تصيير
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const q = `from=${from}&to=${to}`;
  const { data, error, forbidden } = useAdminData<Report>(`/admin/reports/financial?${q}`);
  const [dlError, setDlError] = useState<string | null>(null);

  const download = async (ext: 'csv' | 'xlsx') => {
    try {
      const blob = await apiBlob(`/admin/reports/financial.${ext}?${q}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName('basta-report', ext);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setDlError((e as Error).message);
    }
  };

  return (
    <div className="stack stack--loose">
      <AdminHeader title="التقارير" hint="المبالغ من الدفتر مجمّعة بالعملة — لا تُجمع عملتان في رقم.">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('xlsx')}>
          Excel
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('csv')}>
          CSV
        </button>
      </AdminHeader>
      <div className="row">
        <label className="field">
          <span className="field__label">من</span>
          <input type="date" className="field__control" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">إلى</span>
          <input type="date" className="field__control" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {dlError ? <Alert tone="danger">{dlError}</Alert> : null}

      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__label">بائعون نشطون</span>
              <span className="stat__value num">{data.activeVendors}</span>
            </div>
            <div className="stat">
              <span className="stat__label">معدّل التحويل</span>
              <span className="stat__value num">{data.conversion.ratePct === null ? '—' : `${data.conversion.ratePct}%`}</span>
              <span className="stat__note">
                {data.conversion.paidOrders} من {data.conversion.carts} سلة
              </span>
            </div>
          </div>

          <Card title="المبيعات بعملة الدفع">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>العملة</th>
                    <th>الطلبات</th>
                    <th>المقبوض</th>
                    <th>المُسترد</th>
                    <th>متوسط الطلب</th>
                    <th>هامش الصرف</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sales.map((s) => (
                    <tr key={s.currency}>
                      <td className="num">{s.currency}</td>
                      <td className="num">{s.orders}</td>
                      <td className="money">{money(s.grossMinorUnits, s.currency)}</td>
                      <td className="money">{money(s.refundedMinorUnits, s.currency)}</td>
                      <td className="money">{money(s.averageOrderMinorUnits, s.currency)}</td>
                      <td className="money">{money(s.fxSpreadMinorUnits, s.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="الدفتر بعملة البائعين">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>العملة</th>
                    <th>العمولة</th>
                    <th>ضريبة محصّلة</th>
                    <th>دعم الخصم</th>
                    <th>صافي المنصة</th>
                    <th>مبيعات البائعين</th>
                    <th>استرداداتهم</th>
                    <th>صافي مستحقاتهم</th>
                    <th>سحوبات محوَّلة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((l) => (
                    <tr key={l.currency}>
                      <td className="num">{l.currency}</td>
                      <td className="money">{money(l.commissionMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.taxHeldMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.discountSubsidyMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.platformNetMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.vendorSalesMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.vendorRefundsMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.vendorDuesNetMinorUnits, l.currency)}</td>
                      <td className="money">{money(l.payoutsPaidMinorUnits, l.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="موحّد بالدولار" hint={data.usd.note}>
            <table className="table">
              <tbody>
                {data.usd.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.metric}</td>
                    <td className="num">{r.currency}</td>
                    <td className="small">بسعر {r.rate ?? '—'}</td>
                    <td className="num">{r.usd === null ? 'لا سعر مسجَّل' : `$${r.usd}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
