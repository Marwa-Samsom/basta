'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SESSION_EXPIRED_EVENT } from '@/lib/api';
import { withNext } from '@/lib/safe-path';

/**
 * انتهت الجلسة ولم يجدّدها رمز التحديث (lib/api يطلق الحدث): يعود صاحبها إلى الدخول ثم
 * إلى الصفحة نفسها. كانت كل صفحة تقول «مطلوب تسجيل الدخول» بلا رابط، فيبقى عالقاً.
 * مستمع واحد في الجذر لكل الأقسام — المتجر والحساب ولوحتا البائع والإدارة.
 */
/**
 * الصفحات التي لا تعمل بلا حساب. خارجها (الرئيسية، المنتج، البحث) تسقط الجلسة بصمت ويصير
 * الرأس «ادخل» — من يتصفّح لا يُنتزع إلى نموذج الدخول لأن جرس الإشعارات سأل فرُفض.
 */
const NEEDS_ACCOUNT = ['/account', '/checkout', '/orders/', '/vendor', '/admin'];

export function SessionExpiredRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onExpired = () => {
      if (!NEEDS_ACCOUNT.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`))) return;
      router.replace(withNext('/login', `${pathname}${window.location.search}`));
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router, pathname]);

  return null;
}
