'use client';

import { useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { currentTheme, setTheme, subscribeTheme } from '@/lib/theme';

/**
 * زرّ الوضع — يقلب بين الداكن والفاتح. أيقونته الوضع الذي ينقل إليه: قمر في
 * الفاتح، وشمس في الداكن. في الخادم لا يُعرف الوضع، فيُرسم بالقمر ثم يصحّح.
 */
export function ThemeToggle() {
  const t = useT();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'light' as const);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? t('الوضع الداكن', 'Dark mode') : t('الوضع الفاتح', 'Light mode');
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={() => setTheme(next)}>
      <Icon name={next === 'dark' ? 'moon' : 'sun'} size={18} />
    </button>
  );
}
