'use client';

import Link from 'next/link';
import { DisputeList } from '@/components/dispute-thread';
import { PageHead } from '@/components/ui';
import { Icon } from '@/components/icons';

/** VD-14 — النزاعات على طلبات المتجر */
export default function VendorDisputesPage() {
  return (
    <div className="vm-page">
      <PageHead title="النزاعات" meta="المرتجعات تُدار من صفحة كل طلب." />
      <div className="vm-banner" role="note">
        <Icon name="alert" size={18} />
        <div className="vm-banner__text">
          <p className="vm-banner__title">النزاع المفتوح يوقف تحرير رصيد طلبه حتى يُحسم.</p>
          <p className="vm-banner__body">يبقى المبلغ «قيد التحرير» حتى يُغلق النزاع، وأرباح طلباتك الأخرى لا تتأثّر. الردّ السريع يمنع التصعيد للإدارة.</p>
        </div>
        <Link href="/vendor/finance" className="vm-banner__link">
          افتح المحفظة
        </Link>
      </div>
      <div className="vm-disputes">
        <DisputeList base="/vendor/disputes" link={(id) => `/vendor/disputes/${id}`} searchable />
      </div>
    </div>
  );
}
