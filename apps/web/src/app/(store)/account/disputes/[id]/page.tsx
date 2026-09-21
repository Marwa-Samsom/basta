'use client';

import { use } from 'react';
import { DisputeThread } from '@/components/dispute-thread';

/** ST-21 — خيط النزاع */
export default function MyDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <main className="page">
      <DisputeThread id={id} base="/me/disputes" me="customer" back="/account/disputes" />
    </main>
  );
}
