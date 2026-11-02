'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, MoreButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { localized, type Locale } from '@/lib/i18n';
import { TONE, useAdminList, VENDOR_STATUS, VENDOR_STATUS_EN } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Item {
  id: string;
  nameAr: string;
  slug: string;
  country: string;
  status: string;
  submittedAt: string | null;
  waitingHours: number | null;
  documentsAccepted: number;
  documentsTotal: number;
}

/** مدّة الانتظار بالساعات حتى يوم، ثم بالأيام بتمييزها العربي */
function waited(hours: number, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    if (hours < 24) return `${hours} h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (hours < 24) return `${hours} س`;
  const d = Math.floor(hours / 24);
  if (d === 1) return 'يوم';
  if (d === 2) return 'يومان';
  return d <= 10 ? `${d} أيام` : `${d} يوماً`;
}

/** فوق يومي عمل ينتظر المتجر — يظهر بالأحمر */
const LATE_HOURS = 48;

const PAGE = 100;

/**
 * AD-04 طابور المراجعة (الأقدم أولاً) · AD-06 كل البائعين بحالاتهم.
 *
 * بحث وصفحات (20 أكتوبر 2026): كانت الصفحة تعرض أول مئة بالأقدم ولا شيء بعدها، فمتجر
 * «غزة» بين 5221 معتمداً لا يُوصل إليه إلا برابطه (J-11). البحث بالاسم أو الرابط أو بريد
 * صاحبه داخل الحالة المختارة، و«المزيد» يُلحق المئة التالية.
 */
export default function AdminVendorsPage() {
  const t = useT();
  const locale = useLocale();
  const vendorStatus = localized(locale, VENDOR_STATUS, VENDOR_STATUS_EN);
  const [status, setStatus] = useState('in_review');
  const [search, setSearch] = useState('');
  // الطابور بالأقدم أولاً — من انتظر أطول يُراجَع أولاً
  const [sort, setSort] = useState<SortOrder>('oldest');
  const query = new URLSearchParams({ status, limit: String(PAGE), sort, ...(search.trim() ? { search: search.trim() } : {}) });
  // الطابور يُقرأ بالإزاحة — حالة أو بحث آخر يبدأ القائمة من أولها
  const list = useAdminList<Item>(`/admin/vendors?${query}`, (v) => v.id, 'offset');
  const { data, error, forbidden, reload } = list;
  const queue = status === 'in_review';

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('المتاجر', 'Shops')}
        count={
          data
            ? queue
              ? t(`${data.total} طلب ينتظر`, `${data.total} ${data.total === 1 ? 'request' : 'requests'} waiting`)
              : t(`${data.total} متجر`, `${data.total} ${data.total === 1 ? 'shop' : 'shops'}`)
            : undefined
        }
        hint={
          queue
            ? t('الأقدم أولاً — الانتظار فوق يومي عمل يظهر بالأحمر.', 'Oldest first — waits over two working days show in red.')
            : t('كل المتاجر بحالاتها.', 'All shops with their statuses.')
        }
      />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          label={t('حالة المتجر', 'Shop status')}
          options={['in_review', 'approved', 'suspended', 'rejected', 'pending', 'banned'].map((k) => ({ key: k, label: vendorStatus[k] ?? k }))}
        />
        <div className="toolbar__end">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t('اسم المتجر أو رابطه أو بريد صاحبه', "Shop name, link, or owner's email")}
            label={t('بحث في المتاجر', 'Search shops')}
          />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty
            icon="search"
            title={t('لا متاجر بهذا البحث', 'No shops match this search')}
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                {t('أزل التصفية', 'Clear filters')}
              </button>
            }
          >
            {t('جرّب اسماً آخر أو حالة أخرى من الرقائق أعلاه.', 'Try another name or another status from the chips above.')}
          </Empty>
        ) : queue ? (
          <Empty icon="check-circle" tone="success" title={t('لا طلبات اعتماد معلّقة', 'No pending approval requests')}>
            {t(
              'كل طلبات المتاجر مُراجَعة. ستظهر الطلبات الجديدة هنا فور إرسال التاجر لمستنداته.',
              'All shop requests are reviewed. New requests appear here as soon as a seller submits their documents.',
            )}
          </Empty>
        ) : (
          <Empty icon="store" title={t('لا متاجر بهذه الحالة', 'No shops with this status')}>
            {t('جرّب حالة أخرى من الرقائق أعلاه.', 'Try another status from the chips above.')}
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>{t('المتجر', 'Shop')}</th>
                <th>{t('البلد', 'Country')}</th>
                <th>{t('أُرسل', 'Submitted')}</th>
                <th>{t('الوثائق', 'Documents')}</th>
                {queue ? <th>{t('ينتظر', 'Waiting')}</th> : <th>{t('الحالة', 'Status')}</th>}
                <th className="end">
                  <span className="visually-hidden">{t('الإجراء', 'Action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((v) => {
                const late = queue && v.waitingHours !== null && v.waitingHours >= LATE_HOURS;
                const docsDone = v.documentsTotal > 0 && v.documentsAccepted === v.documentsTotal;
                return (
                  <tr key={v.id} data-late={late}>
                    <td>
                      <span className="ao-shop">
                        <span className="ao-tile" aria-hidden>
                          <Icon name="store" size={16} />
                        </span>
                        <span className="ao-shop__text">
                          <span className="ao-shop__name">{v.nameAr}</span>
                          <span className="ao-shop__sub num">{v.slug}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label={t('البلد', 'Country')} className="num">
                      {v.country}
                    </td>
                    <td data-label={t('أُرسل', 'Submitted')} className="ao-date">
                      {when(v.submittedAt, locale)}
                    </td>
                    <td data-label={t('الوثائق', 'Documents')}>
                      <span className={`badge ${docsDone ? 'badge--success' : 'badge--pending'}`} title={t('الوثائق المقبولة من المطلوبة', 'Accepted documents out of required')}>
                        <Icon name="file" size={12} />
                        <span className="num">
                          {v.documentsAccepted}/{v.documentsTotal}
                        </span>
                      </span>
                    </td>
                    {queue ? (
                      <td data-label={t('ينتظر', 'Waiting')}>
                        {v.waitingHours === null ? (
                          '—'
                        ) : (
                          <span className="ao-wait" data-late={late}>
                            <Icon name="clock" size={12} />
                            {waited(v.waitingHours, locale)}
                          </span>
                        )}
                      </td>
                    ) : (
                      <td data-label={t('الحالة', 'Status')}>
                        <span className={`badge ${TONE[v.status] ?? ''}`}>{vendorStatus[v.status] ?? v.status}</span>
                      </td>
                    )}
                    <td data-label="" className="end">
                      <Link href={`/admin/vendors/${v.id}`} className={`btn btn--sm ${queue ? 'btn--primary' : 'btn--secondary'}`} aria-label={`${queue ? t('راجع', 'Review') : t('افتح', 'Open')} ${v.nameAr}`}
                      >
                        {queue ? t('راجع', 'Review') : t('افتح', 'Open')}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton list={list} />
    </div>
  );
}
