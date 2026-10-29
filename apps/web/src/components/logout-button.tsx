'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { logout } from '@/lib/api';
import { forgetCart } from '@/lib/cart';
import { Alert } from '@/components/ui';

/**
 * زرّ الخروج الواحد — للمشتري والبائع والإدارة. ينهي الجلسة في الخادم وينسى
 * سلّة المتصفّح ثم ينتقل؛ وإن تعذّر ذلك يبقى في مكانه ويقول السبب (lib/api: logout).
 */
export function LogoutButton({
  className,
  next,
  children,
}: {
  className: string;
  /** الوجهة بعد الخروج */
  next: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await logout();
            forgetCart();
            router.replace(next);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </>
  );
}
