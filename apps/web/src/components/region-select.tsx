'use client';

import { Field } from '@/components/ui';
import { REGIONS, canonicalRegion } from '@/lib/places';

/**
 * المحافظة من قائمة البلد — في تغطية البائع وعنوان المشتري معاً، فيكتبان الاسم
 * نفسه. اسم محفوظ قبل القائمة لا يطابق أيّاً منها يبقى خياراً كما كُتب، فلا
 * يُمحى عنوان قديم بفتحه. بلد بلا قائمة يعود حقلاً نصّياً.
 */
export function RegionSelect({
  country,
  value,
  onChange,
  label = 'المحافظة / المنطقة',
  emptyLabel,
  optional,
  error,
  onBlur,
}: {
  country: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** خيار القيمة الفارغة: «كل البلد» في التغطية. بدونه الحقل مطلوب ويبدأ بـ«اختر» */
  emptyLabel?: string;
  optional?: boolean;
  error?: string | null | undefined;
  onBlur?: () => void;
}) {
  const list = REGIONS[country];
  const shown = value ? canonicalRegion(country, value) : '';
  const legacy = shown && list && !list.includes(shown) ? shown : null;

  return (
    <Field label={label} optional={optional} error={error}>
      {(props) =>
        list ? (
          <select className="field__control" {...props} value={shown} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
            {emptyLabel ? <option value="">{emptyLabel}</option> : <option value="" disabled>اختر المحافظة</option>}
            {legacy ? <option value={legacy}>{legacy}</option> : null}
            {list.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <input className="field__control" {...props} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
        )
      }
    </Field>
  );
}
