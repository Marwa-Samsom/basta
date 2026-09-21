'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_BASE, ApiError } from './api';

export interface Me {
  userId: string;
  roles: string[];
  permissions: string[];
}

/**
 * يجلب بيانات صفحة إدارية ويعيد تحميلها عند الطلب. الخطأ نصّ جاهز للعرض،
 * و403 يُميَّز: الصفحة تقول «تحتاج صلاحية كذا» لا «حدث خطأ».
 */
export function useAdminData<T>(path: string | null): {
  data: T | null;
  error: string | null;
  forbidden: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    void (async () => {
      try {
        const next = await api<T>(path);
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (!alive) return;
        setForbidden(e instanceof ApiError && e.status === 403);
        setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, forbidden, reload };
}

/** إجراء بحالة انشغال ورسالة — كل زرّ إداري يمرّ به */
export function useAction(): {
  busy: boolean;
  error: string | null;
  notice: string | null;
  run: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, notice, run, clear: () => (setError(null), setNotice(null)) };
}

export const pct = (bps: number | null | undefined): string =>
  bps === null || bps === undefined ? '—' : `${(bps / 100).toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })}%`;

export const VENDOR_STATUS: Record<string, string> = {
  pending: 'مسوّدة',
  in_review: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  suspended: 'معلَّق',
  banned: 'محظور',
};

export const PRODUCT_STATUS: Record<string, string> = {
  draft: 'مسوّدة',
  pending_review: 'بانتظار المراجعة',
  active: 'منشور',
  rejected: 'مرفوض',
  archived: 'مؤرشف',
};

export const PARENT_STATUS: Record<string, string> = {
  pending_payment: 'بانتظار الدفع',
  payment_failed: 'فشل الدفع',
  processing: 'قيد التنفيذ',
  partially_completed: 'مكتمل جزئياً',
  completed: 'مكتمل',
  canceled: 'ملغى',
  refunded: 'مُسترَد',
};

export const TONE: Record<string, string> = {
  in_review: 'badge--review',
  approved: 'badge--approved',
  active: 'badge--approved',
  published: 'badge--approved',
  paid: 'badge--approved',
  sent: 'badge--approved',
  rejected: 'badge--rejected',
  banned: 'badge--rejected',
  failed: 'badge--rejected',
  suspended: 'badge--warning',
  pending_review: 'badge--warning',
  requested: 'badge--warning',
  escalated: 'badge--warning',
  skipped: 'badge--pending',
};

export const downloadName = (base: string, ext: string) => `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;

/** الصور تُخدم من أصل الخادم على /uploads */
export const media = (path: string | null | undefined): string | null => (path ? `${API_BASE.replace(/\/api\/v1\/?$/, '')}${path}` : null);
