'use client';

import Link from 'next/link';
import { DisputeList } from '@/components/dispute-thread';
import { Icon } from '@/components/icons';
import { PageHead } from '@/components/ui';

/** ST-21 — نزاعاتي */
export default function MyDisputesPage() {
  return (
    <div className="sp-page">
      <Link href="/account/orders" className="sp-back">
        <Icon name="back" size={16} mirror />
        طلباتي
      </Link>
      <PageHead title="نزاعاتي" meta="يردّ المتجر في خيط النزاع، ويمكنك تصعيده للإدارة." />
      <DisputeList base="/me/disputes" link={(id) => `/account/disputes/${id}`} />
    </div>
  );
}
