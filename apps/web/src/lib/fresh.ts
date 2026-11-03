'use client';

import { useEffect, useState } from 'react';

/**
 * عدّاد يزيد كلما رجع المستخدم إلى الصفحة: استعادت النافذة التركيز، أو ظهر التبويب. يُضاف إلى
 * اعتماد الجلب فتُجلب البيانات من جديد بصمت — كانت الصفحات تُجلب عند فتحها وحده، فطلب دُفع
 * وهي مفتوحة في نافذة أخرى لم يظهر إلا بعد F5 (2 نوفمبر 2026).
 *
 * الحدثان يصلان معاً عند الرجوع، وأحدهما عند الفتح نفسه: ثانيتان من آخر جلب على الأقل.
 */
export function useReturnTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let last = Date.now();
    const back = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 2_000) return;
      last = Date.now();
      setTick((n) => n + 1);
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return tick;
}
