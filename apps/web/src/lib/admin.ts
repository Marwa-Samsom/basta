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
 * و403 يُميَّز: الصفحة تقول «تحتاج صلاحية كذا» لا «حدث خطأ». و400 مدخل رفضه الخادم
 * (فترة مقلوبة مثلاً): رسالته وحدها تكفي، لا «حدث خلل غير متوقّع» فوقها (ACFG-090).
 */
export function useAdminData<T>(path: string | null): {
  data: T | null;
  error: string | null;
  forbidden: boolean;
  invalid: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string; forbidden: boolean; invalid: boolean } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    void (async () => {
      try {
        const next = await api<T>(path);
        if (alive) {
          setData(next);
          setFailure(null);
        }
      } catch (e) {
        if (!alive) return;
        setFailure({
          path,
          message: (e as Error).message,
          forbidden: e instanceof ApiError && e.status === 403,
          invalid: e instanceof ApiError && e.status === 400,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  /**
   * فشل طلب المسار الحالي يُسقط نتيجة ما قبله: كانت تبقى بلا رسالة، فتظهر «طاقية صوف» المؤرشفة
   * تحت «بيت الفخار · موقوف»، والقائمة كاملة تحت بحث رفضه الخادم (ADM-048، 30 أكتوبر 2026).
   * وأثناء التحميل تبقى السابقة حتى تصل التالية، فلا ترمش القائمة مع كل حرف.
   */
  const failed = failure?.path === path ? failure : null;
  return {
    data: failed ? null : data,
    error: failed?.message ?? null,
    forbidden: failed?.forbidden ?? false,
    invalid: failed?.invalid ?? false,
    reload,
  };
}

/**
 * قائمة إدارية تكبر مع الوقت — الصفحة الأولى بـ `useAdminData`، و`more()` يُلحق التالية
 * (`page=N`، أو `offset=<المعروض>` لما يُقرأ بالإزاحة). الصفحات الملحقة مربوطة بمسار الأولى:
 * بحث أو حالة أخرى = مسار آخر، فتبدأ القائمة من أولها بلا تأثير جانبي يمسحها. و`reload()`
 * بعد إجراء يعيدها إلى الأولى بأرقامها الجديدة. الصفّ المكرّر (قائمة تحرّكت بين صفحتين)
 * يُسقط بمفتاحه.
 *
 * كانت القوائم تقف عند أول مئة أو مئتين بلا ما بعدها (J-11، 20 أكتوبر 2026). ولوحة البائع
 * تستعمله كذلك، و`Extra` ما يعود مع الصفحة الأولى غير القائمة (عدّادات الحالات مثلاً).
 */
export function useAdminList<T, Extra extends object = object>(
  path: string | null,
  key: (row: T) => string,
  paging: 'page' | 'offset' = 'page',
): {
  data: ({ items: T[]; total: number } & Extra) | null;
  items: T[];
  total: number;
  error: string | null;
  forbidden: boolean;
  reload: () => void;
  more: () => void;
  /** «السابق»: تُسقط آخر صفحة ألحقها «المزيد» فتعود القائمة كما كانت قبلها */
  less: () => void;
  canLess: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: string | null;
} {
  const first = useAdminData<{ items: T[]; total: number } & Extra>(path);
  const [extra, setExtra] = useState<{ path: string | null; pages: T[][] }>({ path: null, pages: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<{ path: string | null; message: string } | null>(null);
  const pages = extra.path === path ? extra.pages : [];

  const items: T[] = [];
  const seen = new Set<string>();
  for (const row of [...(first.data?.items ?? []), ...pages.flat()]) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(row);
  }
  const total = first.data?.total ?? 0;

  const more = () => {
    if (!path || !first.data || loadingMore) return;
    const sep = path.includes('?') ? '&' : '?';
    const at = paging === 'offset' ? `offset=${first.data.items.length + pages.reduce((n, p) => n + p.length, 0)}` : `page=${pages.length + 2}`;
    setLoadingMore(true);
    setMoreError(null);
    void api<{ items: T[] }>(`${path}${sep}${at}`)
      .then((next) => setExtra((e) => ({ path, pages: [...(e.path === path ? e.pages : []), next.items] })))
      .catch((e: Error) => setMoreError({ path, message: e.message }))
      .finally(() => setLoadingMore(false));
  };

  const less = () => {
    setMoreError(null);
    setExtra((e) => ({ path, pages: (e.path === path ? e.pages : []).slice(0, -1) }));
  };

  const reload = () => {
    setExtra({ path: null, pages: [] });
    setMoreError(null);
    first.reload();
  };

  return {
    data: first.data,
    items,
    total,
    error: first.error,
    forbidden: first.forbidden,
    reload,
    more,
    less,
    canLess: pages.length > 0,
    // صفحة ملحقة فارغة نهاية القائمة حتى لو نقص المعروض عن الإجمالي بمكرّر أُسقط
    hasMore: !!first.data && items.length < total && pages.at(-1)?.length !== 0,
    loadingMore,
    moreError: moreError?.path === path ? moreError.message : null,
  };
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
  active: 'منشور',
  rejected: 'موقوف',
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
  requested: 'badge--warning',
  escalated: 'badge--warning',
  skipped: 'badge--pending',
};

export const downloadName = (base: string, ext: string) => `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;

/** الصور تُخدم من أصل الخادم على /uploads */
export const media = (path: string | null | undefined): string | null => (path ? `${API_BASE.replace(/\/api\/v1\/?$/, '')}${path}` : null);
