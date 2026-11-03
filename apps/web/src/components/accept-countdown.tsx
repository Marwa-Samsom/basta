'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui';
import { useLocale, useT } from '@/components/locale';
import { counted, type Counted } from '@/lib/arabic-count';
import type { Locale } from '@/lib/i18n';
import { hoursAr } from '@/lib/orders';

/**
 * ما بقي من مهلة قبول التاجر — VOPS-003، 3 نوفمبر 2026. كان الشريط والتفاصيل يقولان «خلال 48 ساعة»
 * وحدها، فطلبٌ يُلغى آلياً بعد ساعتين يبدو في القائمة كطلبٍ بقي له 47: لا يعرف التاجر أيّها يلحق أولاً.
 * الآن لكل طلب منتظر وقته الباقي يتناقص وحده، بلون التحذير تحت يوم والخطر تحت ساعتين.
 */

const HOURS: Counted = { one: 'ساعة واحدة', two: 'ساعتان', plural: '# ساعات', accusative: '# ساعة', genitive: '# ساعة' };
const MINUTES: Counted = { one: 'دقيقة واحدة', two: 'دقيقتان', plural: '# دقائق', accusative: '# دقيقة', genitive: '# دقيقة' };

const HOUR = 3_600_000;
const MINUTE = 60_000;

export type CountdownTone = 'normal' | 'warning' | 'danger';

/** الوقت الباقي كلاماً ونبرةً: «بقي 18 ساعة»، «بقي ساعة و20 دقيقة»، «بقي 45 دقيقة» */
export function acceptLeft(by: Date, now: number, locale: Locale): { text: string; tone: CountdownTone } {
  const ms = by.getTime() - now;
  const tone: CountdownTone = ms < 2 * HOUR ? 'danger' : ms < 24 * HOUR ? 'warning' : 'normal';
  if (ms <= 0) return { text: locale === 'en' ? 'Deadline passed' : 'انتهت المهلة', tone };
  // تقريب لأسفل: 47.9 ساعة «بقي 47 ساعة» — لا يُوعد التاجر بوقت ليس عنده
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.max(1, Math.floor((ms % HOUR) / MINUTE));
  if (locale === 'en') {
    if (ms < HOUR) return { text: `${Math.max(1, Math.floor(ms / MINUTE))} min left`, tone };
    if (ms < 2 * HOUR) return { text: `1 hour ${minutes} min left`, tone };
    return { text: `${hours} hours left`, tone };
  }
  if (ms < HOUR) return { text: `بقي ${counted(Math.max(1, Math.floor(ms / MINUTE)), MINUTES)}`, tone };
  // تحت الساعتين الدقائق تفرق: «ساعة واحدة» تعني من 60 إلى 119 دقيقة
  if (ms < 2 * HOUR) return { text: `بقي ساعة و${counted(minutes, MINUTES)}`, tone };
  return { text: `بقي ${counted(hours, HOURS)}`, tone };
}

/** ساعة الصفحة: تتقدّم كل نصف دقيقة فيتناقص العدّاد بلا إعادة تحميل */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** في صف القائمة تحت شارة الحالة */
export function AcceptCountdown({ by }: { by: Date }) {
  const locale = useLocale();
  const now = useNow();
  const { text, tone } = acceptLeft(by, now, locale);
  return (
    <span className="vm-countdown" data-tone={tone}>
      {text}
    </span>
  );
}

/** تنبيه التفاصيل: الوقت الباقي عنواناً، ونبرته خطر تحت ساعتين */
export function AcceptDeadline({ by, hours }: { by: Date; hours: number }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const { text, tone } = acceptLeft(by, now, locale);
  return (
    <Alert
      tone={tone === 'danger' ? 'danger' : 'warning'}
      title={by.getTime() > now ? t(`${text} على الإلغاء الآلي`, `${text} before automatic cancellation`) : text}
    >
      {t(
        `اقبل الطلب أو ارفضه خلال ${hoursAr(hours)} من وصوله، وإلا أُلغي آلياً.`,
        `Accept or reject the order within ${hoursAr(hours, locale)} of its arrival, or it is canceled automatically.`,
      )}
    </Alert>
  );
}
