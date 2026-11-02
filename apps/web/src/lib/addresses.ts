/**
 * دفتر العناوين — الأنواع والتنسيق المشترك بين ST-26 (العناوين) ومنتقي
 * العنوان المحفوظ في الدفع (ST-15).
 */
import type { Locale } from './i18n';
import { regionName } from './places';

export interface SavedAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  country: string;
  region: string;
  city: string;
  area: string | null;
  street: string;
  building: string | null;
  floor: string | null;
  landmark: string | null;
  isDefault: boolean;
}

/** البلدان نفسها التي يعرضها نموذج الدفع — عنوان محفوظ يُملأ فيه كما هو */
export const COUNTRIES: readonly { code: string; name: string; nameEn: string }[] = [
  { code: 'JO', name: 'الأردن', nameEn: 'Jordan' },
  { code: 'SA', name: 'السعودية', nameEn: 'Saudi Arabia' },
  { code: 'AE', name: 'الإمارات', nameEn: 'United Arab Emirates' },
  { code: 'KW', name: 'الكويت', nameEn: 'Kuwait' },
  { code: 'EG', name: 'مصر', nameEn: 'Egypt' },
];

export const countryName = (code: string, locale: Locale = 'ar'): string => {
  const country = COUNTRIES.find((c) => c.code === code);
  return (locale === 'en' ? country?.nameEn : country?.name) ?? code;
};

/** «المنزل» إن سمّاه صاحبه، وإلا المدينة — البطاقة لا تبقى بلا عنوان */
export const addressTitle = (a: Pick<SavedAddress, 'label' | 'city'>): string => a.label?.trim() || a.city;

/** سطر واحد يُقرأ من الأعم إلى الأخص: البلد · المنطقة · المدينة · الحي · الشارع · المبنى */
export function addressLine(a: SavedAddress, locale: Locale = 'ar'): string {
  // بالإنجليزية: البلد والمنطقة من القائمة، وما كتبه صاحب العنوان كما هو
  if (locale === 'en') {
    const building = [a.building, a.floor ? `Floor ${a.floor}` : null].filter(Boolean).join(', ');
    return [countryName(a.country, locale), regionName(a.country, a.region, locale), a.city, a.area, a.street, building || null]
      .filter(Boolean)
      .join(' · ');
  }
  const building = [a.building, a.floor ? `الطابق ${a.floor}` : null].filter(Boolean).join('، ');
  return [countryName(a.country), a.region, a.city, a.area, a.street, building || null].filter(Boolean).join(' · ');
}

/** عدد العناوين بتمييزه العربي */
export function addressCount(n: number, locale: Locale = 'ar'): string {
  if (locale === 'en') return n === 1 ? '1 address' : `${n} addresses`;
  if (n === 1) return 'عنوان واحد';
  if (n === 2) return 'عنوانان';
  if (n <= 10) return `${n} عناوين`;
  return `${n} عنواناً`;
}

/** حدث داخل الصفحة: تغيّر عدد غير المقروء فيُحدَّث عدّاد التنقّل بلا انتظار */
export const NOTIFICATIONS_CHANGED = 'basta:notifications-changed';
