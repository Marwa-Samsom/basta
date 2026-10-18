'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { chooseCurrency } from '@/lib/currency';
import type { CurrencyOption } from '@/lib/storefront';

/**
 * عملة العرض في رأس المتجر — قرار 18 أكتوبر 2026. يظهر الرمز وحده (JOD) كي
 * لا يزاحم البحث، وفوقه قائمة أصلية شفّافة بأسماء العملات كاملة: لوحة المفاتيح
 * وقارئ الشاشة وقائمة الجوال الأصلية تعمل كما هي بلا قائمة مصنوعة.
 */
export function CurrencyPicker({ current, options }: { current: string; options: CurrencyOption[] }) {
  const [busy, setBusy] = useState(false);
  if (options.length < 2) return null;
  return (
    <label className="cur-pick" data-busy={busy || undefined} title="عملة العرض والدفع">
      <span className="cur-pick__code num" aria-hidden="true">
        {current}
      </span>
      <Icon name="chev-down" size={14} />
      <select
        className="cur-pick__select"
        aria-label="عملة العرض والدفع"
        value={current}
        disabled={busy}
        onChange={(e) => {
          setBusy(true);
          void chooseCurrency(e.target.value);
        }}
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.nameAr} ({c.code})
          </option>
        ))}
      </select>
    </label>
  );
}
