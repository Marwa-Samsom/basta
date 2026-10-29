'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * `<details>` يُغلق بالضغط في أي مكان خارجه وبـ Esc — قائمة الترتيب ودرج التصفية
 * (27 أكتوبر 2026، بطلب صاحبة المشروع). يبقى `<details>` أصلياً يُفتح بلا سكربت،
 * والسكربت يضيف الإغلاق وحده كما يفعل الجرس.
 *
 * `click` لا `pointerdown`: لمسة تمرير على الجوال تبدأ بـ pointerdown فكانت ستُغلق
 * درج التصفية أثناء تصفّحه. و`closeOnSelect` يُغلق القائمة حين يُختار منها رابط —
 * الانتقال لا يعيد رسم `<details>` فكانت تبقى مفتوحة فوق النتائج الجديدة.
 */
export function DismissableDetails({
  className,
  closeOnSelect = false,
  children,
}: {
  className: string;
  closeOnSelect?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (!el.open) return;
      const target = e.target as Element;
      if (!el.contains(target) || (closeOnSelect && target.closest('a'))) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !el.open) return;
      el.open = false;
      el.querySelector('summary')?.focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [closeOnSelect]);

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}
