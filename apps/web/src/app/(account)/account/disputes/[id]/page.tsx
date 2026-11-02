'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useSyncExternalStore } from 'react';
import { DisputeThread } from '@/components/dispute-thread';
import { session } from '@/lib/api';

/** ST-21 — خيط النزاع. الضيف إلى الدخول ثم إلى الخيط نفسه، كقائمة «نزاعاتي» (BUY-063) */
export default function MyDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const signedIn = useSyncExternalStore(
    () => () => undefined,
    () => session.read() !== null,
    () => false,
  );

  useEffect(() => {
    if (!session.read()) router.replace(`/login?next=/account/disputes/${id}`);
  }, [router, id]);

  return (
    <div className="sp-page sp-page--mid">
      {signedIn ? <DisputeThread id={id} base="/me/disputes" me="customer" back="/account/disputes" /> : null}
    </div>
  );
}
