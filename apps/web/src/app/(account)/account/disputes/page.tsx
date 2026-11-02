'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { DisputeList } from '@/components/dispute-thread';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { PageHead } from '@/components/ui';
import { session } from '@/lib/api';

/**
 * ST-21 — نزاعاتي.
 *
 * الضيف إلى الدخول كبقية صفحات الحساب، والقائمة لا تُجلب قبل أن تُعرف الجلسة —
 * كانت تُجلب ضيفاً فتقف على «مطلوب تسجيل الدخول.» بلا طريق إلى الدخول (BUY-063).
 */
export default function MyDisputesPage() {
  const t = useT();
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
        {t('طلباتي', 'My orders')}
      </Link>
      <PageHead
        title={t('نزاعاتي', 'My disputes')}
        meta={t('يردّ المتجر في خيط النزاع، ويمكنك تصعيده للإدارة.', 'The shop replies in the dispute thread, and you can escalate it to admin.')}
      />
      {signedIn ? <DisputeList base="/me/disputes" link={(id) => `/account/disputes/${id}`} /> : null}
    </div>
  );
}
