'use client';

import { use } from 'react';
import { DisputeThread } from '@/components/dispute-thread';

/** VD-14 — خيط النزاع من جهة البائع */
export default function VendorDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="vm-dispute">
      <DisputeThread id={id} base="/vendor/disputes" me="vendor" back="/vendor/disputes" />
    </div>
  );
}
