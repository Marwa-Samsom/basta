import type { Locale } from './i18n';

/**
 * المحافظات والمناطق الإدارية لكل بلد تبيع فيه بسطة — قائمة واحدة يختار منها
 * البائع تغطيته والمشتري عنوانه، فيكتبان الاسم نفسه. كانت حقلاً حرّاً لكليهما
 * والمطابقة حرفية: «عمّان» عند المشتري لا تطابق «عمان» عند البائع.
 *
 * الاسم المحفوظ قبل القائمة يبقى ويُعرض كما هو (`RegionSelect`)، والخادم
 * يقارن بـ `placeKey` فلا يسقط عنوان قديم.
 */
export const REGIONS: Readonly<Record<string, readonly string[]>> = {
  JO: ['عمّان', 'إربد', 'الزرقاء', 'البلقاء', 'المفرق', 'جرش', 'عجلون', 'مأدبا', 'الكرك', 'الطفيلة', 'معان', 'العقبة'],
  SA: [
    'الرياض',
    'مكة المكرمة',
    'المدينة المنورة',
    'المنطقة الشرقية',
    'القصيم',
    'عسير',
    'تبوك',
    'حائل',
    'الحدود الشمالية',
    'جازان',
    'نجران',
    'الباحة',
    'الجوف',
  ],
  AE: ['أبوظبي', 'دبي', 'الشارقة', 'عجمان', 'أم القيوين', 'رأس الخيمة', 'الفجيرة'],
  KW: ['العاصمة', 'حولي', 'الفروانية', 'الأحمدي', 'الجهراء', 'مبارك الكبير'],
  EG: [
    'القاهرة',
    'الجيزة',
    'الإسكندرية',
    'القليوبية',
    'الدقهلية',
    'الشرقية',
    'الغربية',
    'المنوفية',
    'البحيرة',
    'كفر الشيخ',
    'دمياط',
    'بورسعيد',
    'الإسماعيلية',
    'السويس',
    'شمال سيناء',
    'جنوب سيناء',
    'الفيوم',
    'بني سويف',
    'المنيا',
    'أسيوط',
    'سوهاج',
    'قنا',
    'الأقصر',
    'أسوان',
    'البحر الأحمر',
    'الوادي الجديد',
    'مطروح',
  ],
  QA: ['الدوحة', 'الريان', 'الوكرة', 'الخور', 'الشمال', 'أم صلال', 'الظعاين', 'الشحانية'],
  BH: ['العاصمة', 'المحرق', 'الشمالية', 'الجنوبية'],
  OM: ['مسقط', 'ظفار', 'مسندم', 'البريمي', 'الداخلية', 'شمال الباطنة', 'جنوب الباطنة', 'جنوب الشرقية', 'شمال الشرقية', 'الظاهرة', 'الوسطى'],
};

/**
 * الأسماء نفسها بالإنجليزية للعرض وحده، بترتيب `REGIONS` نفسه (الموضع بالموضع).
 * القيمة المحفوظة والمُرسلة للخادم تبقى الاسم العربي.
 */
export const REGIONS_EN: Readonly<Record<string, readonly string[]>> = {
  JO: ['Amman', 'Irbid', 'Zarqa', 'Balqa', 'Mafraq', 'Jerash', 'Ajloun', 'Madaba', 'Karak', 'Tafilah', "Ma'an", 'Aqaba'],
  SA: [
    'Riyadh',
    'Makkah',
    'Madinah',
    'Eastern Province',
    'Qassim',
    'Asir',
    'Tabuk',
    "Ha'il",
    'Northern Borders',
    'Jazan',
    'Najran',
    'Al Bahah',
    'Al Jawf',
  ],
  AE: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'],
  KW: ['Capital', 'Hawalli', 'Farwaniya', 'Ahmadi', 'Jahra', 'Mubarak Al-Kabeer'],
  EG: [
    'Cairo',
    'Giza',
    'Alexandria',
    'Qalyubia',
    'Dakahlia',
    'Sharqia',
    'Gharbia',
    'Monufia',
    'Beheira',
    'Kafr El Sheikh',
    'Damietta',
    'Port Said',
    'Ismailia',
    'Suez',
    'North Sinai',
    'South Sinai',
    'Faiyum',
    'Beni Suef',
    'Minya',
    'Asyut',
    'Sohag',
    'Qena',
    'Luxor',
    'Aswan',
    'Red Sea',
    'New Valley',
    'Matrouh',
  ],
  QA: ['Doha', 'Al Rayyan', 'Al Wakrah', 'Al Khor', 'Al Shamal', 'Umm Salal', 'Al Daayen', 'Al Shahaniya'],
  BH: ['Capital', 'Muharraq', 'Northern', 'Southern'],
  OM: [
    'Muscat',
    'Dhofar',
    'Musandam',
    'Al Buraimi',
    'Ad Dakhiliyah',
    'North Al Batinah',
    'South Al Batinah',
    'South Ash Sharqiyah',
    'North Ash Sharqiyah',
    'Ad Dhahirah',
    'Al Wusta',
  ],
};

/**
 * مفتاح مقارنة أسماء الأماكن — نسخة `api/src/common/places.ts` حرفاً بحرف:
 * معاينة الشحن تحسب هنا بالقاعدة التي يحسب بها الخادم.
 */
export function placeKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(محافظه|منطقه|اماره|ولايه)\s+/, '');
}

export const samePlace = (a: string | null | undefined, b: string | null | undefined): boolean => placeKey(a) === placeKey(b);

/** اسم القائمة الذي يطابق ما كُتب، أو ما كُتب نفسه إن لم يطابق شيئاً */
export function canonicalRegion(country: string, value: string): string {
  return (REGIONS[country] ?? []).find((r) => samePlace(r, value)) ?? value;
}

/**
 * اسم المنطقة للعرض بلغة الصفحة: بالإنجليزية إن طابق القائمة، وإلا ما كُتب كما هو.
 * بالعربية يعود ما كُتب بلا تغيير.
 */
export function regionName(country: string, value: string, locale: Locale = 'ar'): string {
  if (locale !== 'en') return value;
  const at = (REGIONS[country] ?? []).findIndex((r) => samePlace(r, value));
  return at >= 0 ? (REGIONS_EN[country]?.[at] ?? value) : value;
}
