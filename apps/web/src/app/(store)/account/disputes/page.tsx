'use client';

import { DisputeList } from '@/components/dispute-thread';

/** ST-21 — نزاعاتي */
export default function MyDisputesPage() {
  return (
    <main className="page stack stack--loose">
      <h1>نزاعاتي</h1>
      <DisputeList base="/me/disputes" link={(id) => `/account/disputes/${id}`} />
    </main>
  );
}
