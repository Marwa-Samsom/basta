'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { DisputeList } from '@/components/dispute-thread';
import { Icon } from '@/components/icons';
import { PageHead } from '@/components/ui';
import { session } from '@/lib/api';

/**
 * ST-21 — نزاعاتي.
 *
 * الضيف إلى الدخول كبقية صفحات الحساب، والقائمة لا تُجلب قبل أن تُعرف الجلسة —
 * كانت تُجلب ضيفاً فتقف على «مطلوب تسجيل الدخول.» بلا طريق إلى الدخول (BUY-063).
 */
export default function MyDisputesPage() {
  const router = useRouter();
  const signedIn = useSyncExternalStore(
    () => () => undefined,
    () => session.read() !== null,
    () => false,
  );

  useEffect(() => {
    if (!session.read()) router.replace('/login?next=/account/disputes');
  }, [router]);

  return (
    <div className="sp-page">
      <Link href="/account/orders" className="sp-back">
        <Icon name="back" size={16} mirror />
        طلباتي
      </Link>
      <PageHead title="نزاعاتي" meta="يردّ المتجر في خيط النزاع، ويمكنك تصعيده للإدارة." />
      {signedIn ? <DisputeList base="/me/disputes" link={(id) => `/account/disputes/${id}`} /> : null}
    </div>
  );
}
