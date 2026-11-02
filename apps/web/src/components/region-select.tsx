'use client';

import { useLocale, useT } from '@/components/locale';
import { ClearableInput, Field } from '@/components/ui';
import { REGIONS, canonicalRegion, regionName } from '@/lib/places';

/**
 * المحافظة من قائمة البلد — في تغطية البائع وعنوان المشتري معاً، فيكتبان الاسم
 * نفسه. اسم محفوظ قبل القائمة لا يطابق أيّاً منها يبقى خياراً كما كُتب، فلا
 * يُمحى عنوان قديم بفتحه. بلد بلا قائمة يعود حقلاً نصّياً.
 */
export function RegionSelect({
  country,
  value,
  onChange,
  label,
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
  const t = useT();
  const locale = useLocale();
  const list = REGIONS[country];
  const shown = value ? canonicalRegion(country, value) : '';
  const legacy = shown && list && !list.includes(shown) ? shown : null;

  return (
    <Field label={label ?? t('المحافظة / المنطقة', 'Governorate / region')} optional={optional} error={error}>
      {(props) =>
        list ? (
          <select className="field__control" {...props} value={shown} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
            {emptyLabel ? <option value="">{emptyLabel}</option> : <option value="" disabled>{t('اختر المحافظة', 'Choose a governorate')}</option>}
            {legacy ? <option value={legacy}>{legacy}</option> : null}
            {list.map((r) => (
              <option key={r} value={r}>
                {regionName(country, r, locale)}
              </option>
            ))}
          </select>
        ) : (
          <ClearableInput className="field__control" {...props} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
        )
      }
    </Field>
  );
}
