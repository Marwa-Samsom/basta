'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Card, Spinner } from '@/components/ui';
import { api, session } from '@/lib/api';
import { labelOf, money, toneOf, when } from '@/lib/orders';

interface Row {
  number: string;
  status: string;
  currency: string;
  grandTotalMinorUnits: string;
  placedAt: string;
  stores: { vendor: string; status: string; items: { productNameSnapshotAr: string; qty: number }[] }[];
}

const PARENT_LABEL: Record<string, string> = {
  processing: 'قيد التنفيذ',
  partially_completed: 'مكتمل جزئياً',
  completed: 'مكتمل',
  canceled: 'ملغى',
  refunded: 'مُسترَد',
};

/**
 * ST-18 — طلباتي.
 *
 * طلب واحد من عدّة متاجر يظهر طلباً واحداً — بحالة كل متجر تحته، لأن كل
 * متجر يشحن وحده ويصل وحده.
 */
export default function MyOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/account/orders');
      return;
    }
    api<{ items: Row[] }>('/me/orders')
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <main className="page stack stack--loose">
      <header className="row row--between">
        <h1>طلباتي</h1>
        <Link href="/account/disputes" className="small">
          النزاعات
        </Link>
      </header>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!rows && !error ? <Spinner label="جارٍ جلب طلباتك…" /> : null}
      {rows && rows.length === 0 ? (
        <Card>
          <p className="empty muted">لا طلبات بعد.</p>
          <Link href="/" className="btn btn--primary">
            تسوّق الآن
          </Link>
        </Card>
      ) : null}
      {rows?.map((o) => (
        <Link key={o.number} href={`/account/orders/${o.number}`} className="card stack stack--tight" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="row row--between">
            <strong className="num">{o.number}</strong>
            <span className="badge badge--pending">{PARENT_LABEL[o.status] ?? o.status}</span>
          </div>
          <div className="row row--between small muted">
            <span>{when(o.placedAt)}</span>
            <span className="money">{money(o.grandTotalMinorUnits, o.currency)}</span>
          </div>
          <ul className="stack stack--tight">
            {o.stores.map((s, i) => (
              <li key={i} className="row row--between small">
                <span>
                  {s.vendor} · {s.items.map((it) => it.productNameSnapshotAr).join('، ')}
                </span>
                <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status)}</span>
              </li>
            ))}
          </ul>
        </Link>
      ))}
    </main>
  );
}
