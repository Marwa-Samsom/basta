'use client';

import Link from 'next/link';
import { DisputeList } from '@/components/dispute-thread';
import { PageHead } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';

/** VD-14 — النزاعات على طلبات المتجر */
export default function VendorDisputesPage() {
  const t = useT();
  return (
    <div className="vm-page">
      <PageHead title={t('النزاعات', 'Disputes')} meta={t('المرتجعات تُدار من صفحة كل طلب.', 'Returns are handled from each order’s page.')} />
      <div className="vm-banner" role="note">
        <Icon name="alert" size={18} />
        <div className="vm-banner__text">
          <p className="vm-banner__title">{t('النزاع المفتوح يوقف تحرير رصيد طلبه حتى يُحسم.', 'An open dispute holds the release of its order’s balance until it is resolved.')}</p>
          <p className="vm-banner__body">{t('يبقى المبلغ «قيد التحرير» حتى يُغلق النزاع، وأرباح طلباتك الأخرى لا تتأثّر. الردّ السريع يمنع التصعيد للإدارة.', 'The amount stays “pending release” until the dispute is closed; earnings from your other orders are not affected. A quick reply prevents escalation to admin.')}</p>
        </div>
        <Link href="/vendor/finance" className="vm-banner__link">
          {t('افتح المحفظة', 'Open wallet')}
        </Link>
      </div>
      <div className="vm-disputes">
        <DisputeList base="/vendor/disputes" link={(id) => `/vendor/disputes/${id}`} searchable />
      </div>
    </div>
  );
}
