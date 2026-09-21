'use client';

import { DisputeList } from '@/components/dispute-thread';

/** VD-17 — النزاعات على طلبات المتجر */
export default function VendorDisputesPage() {
  return (
    <div className="stack stack--loose">
      <h1>النزاعات</h1>
      <p className="small muted">نزاع مفتوح يجمّد مال طلبه حتى يُحسم. الردّ السريع يمنع التصعيد للإدارة.</p>
      <DisputeList base="/vendor/disputes" link={(id) => `/vendor/disputes/${id}`} />
    </div>
  );
}
