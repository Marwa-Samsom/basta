'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import '@/styles/screens/wish-heart.css';
import { Icon } from '@/components/icons';
import { ApiError, session } from '@/lib/api';
import { ensureToastRegion, setSaved, useWishlistIds, wishToast } from '@/lib/wishlist';

/**
 * القلب — احفظ في المفضّلة أو أزل منها. جزيرة عميل صغيرة داخل بطاقة تُصيَّر
 * في الخادم: تُرسم أولاً فارغة (كما للضيف) ثم تمتلئ حين تصل المعرّفات،
 * والمعرّفات تُجلب مرة للصفحة كلها لا لكل بطاقة (`lib/wishlist`).
 *
 * الضيف يُحوَّل إلى الدخول ويعود إلى الصفحة نفسها.
 */
export function WishHeart({
  productId,
  name,
  variant,
}: {
  productId: string;
  /** اسم المنتج — في تسمية زرّ البطاقة، فلا تتشابه قلوب الشبكة لقارئ الشاشة */
  name: string;
  variant: 'pdp' | 'card';
}) {
  const ids = useWishlistIds();
  const saved = ids?.has(productId) ?? false;
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(ensureToastRegion, []);

  /**
   * الوجهة بعد الدخول هي الصفحة بمعاملاتها: من «أحذية» في المتجر يعود إلى «أحذية» لا «الكل»
   * (DISC-075، 27 أكتوبر 2026). كان المسار وحده فيسقط ?category=.
   */
  const toLogin = (): void => router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);

  async function toggle(): Promise<void> {
    // لا `disabled` أثناء الطلب: تعطيل الزرّ المركَّز يُسقط تركيز لوحة المفاتيح إلى أول الصفحة
    if (busy) return;
    if (!session.read()) {
      toLogin();
      return;
    }
    const next = !saved;
    setBusy(true);
    try {
      await setSaved(productId, next);
      wishToast(next ? 'أُضيف إلى المفضّلة' : 'أُزيل من المفضّلة');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        toLogin();
        return;
      }
      wishToast(err instanceof Error ? err.message : 'تعذّر تحديث المفضّلة. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  const label =
    variant === 'pdp'
      ? saved
        ? 'أزل من المفضّلة'
        : 'احفظ في المفضّلة'
      : saved
        ? `أزل «${name}» من المفضّلة`
        : `احفظ «${name}» في المفضّلة`;

  return (
    <button
      type="button"
      className={`wish-heart wish-heart--${variant}`}
      aria-pressed={saved}
      aria-label={label}
      title={saved ? 'أزل من المفضّلة' : 'احفظ في المفضّلة'}
      aria-busy={busy}
      onClick={() => void toggle()}
    >
      <Icon name={saved ? 'heart-fill' : 'heart'} size={variant === 'pdp' ? 20 : 16} />
    </button>
  );
}
