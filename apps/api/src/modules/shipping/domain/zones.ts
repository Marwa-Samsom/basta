/**
 * مناطق الشحن وتسعيراتها — VD-16. دوال نقية تقرّر **أيّ شكل يُقبل**.
 *
 * المستهلك الوحيد لهذه الجداول هو `quoteShipping` في وحدة التسعير، وقواعده:
 *   · المنطقة المفعّلة وحدها تُقرأ، والتسعيرة المفعّلة وحدها تُحسب
 *   · البلد يُقارن بلا حالة أحرف، والمحافظة والمدينة بعد قصّ الفراغ حرفياً
 *   · الأدقّ يفوز: مدينة (3) قبل محافظة (2) قبل بلد (1) — **وعند التعادل يفوز
 *     أوّل ما تعيده القاعدة**، بلا ترتيب مضمون
 *   · تُختار المنطقة أولاً ثم أرخص تسعيرة فيها؛ منطقة بلا تسعيرة مفعّلة تُرجع
 *     «لم يحدّد سعر شحن» ولو غطّت منطقةٌ أعمّ العنوانَ نفسه بسعر
 *   · by_weight = السعر الأساسي + سعر الكيلو × الكيلوغرامات (تقريب لأعلى، 1 أدنى)
 *   · free_over = صفر إن بلغت قيمة المنتجات الحدّ، وإلا السعر الأساسي
 *
 * لذلك يُرفض هنا كل شكل يجعل النتيجة عشوائية أو مفاجئة: تغطيتان متعادلتان
 * في منطقتين مفعّلتين، ومنطقة مفعّلة بلا تسعيرة مفعّلة أو بلا تغطية، وحقل
 * تسعير لا تقرؤه الطريقة المختارة (كان سيُحفظ ويُتجاهل بصمت).
 */

export const RATE_METHODS = ['flat', 'by_weight', 'free_over'] as const;
export type RateMethod = (typeof RATE_METHODS)[number];

export const MAX_DAYS = 90;
export const MAX_REGIONS_PER_ZONE = 200;
export const MAX_RATES_PER_ZONE = 10;
export const MAX_ZONES_PER_VENDOR = 50;

export interface RegionShape {
  readonly country: string;
  readonly region: string | null;
  readonly city: string | null;
}

export interface RateShape {
  readonly method: RateMethod;
  readonly priceMinor: bigint;
  readonly perKgMinor: bigint | null;
  readonly freeOverMinor: bigint | null;
  readonly minDays: number;
  readonly maxDays: number;
}

/** خطأ تحقّق برسالة للبائع وحقل يُشار إليه */
export class ShapeError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

/** قصّ الطرفين وحده — كما يفعل `quoteShipping`؛ أيّ توحيد أبعد يصنع فرقاً لا يراه التسعير */
const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * يوحّد سطر تغطية كما تقرؤه نواة التسعير: البلد بأحرف كبيرة، والفارغ null
 * (نصّ فارغ كان سيُقرأ «بلا محافظة» في التسعير ويبدو محافظةً في الواجهة).
 */
export function normalizeRegion(r: { country: string; region?: string | null | undefined; city?: string | null | undefined }): RegionShape {
  const country = r.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new ShapeError('رمز البلد حرفان لاتينيان (SA، JO…).', 'regions.country');
  return { country, region: clean(r.region), city: clean(r.city) };
}

export const regionKey = (r: RegionShape): string => `${r.country}|${r.region ?? ''}|${r.city ?? ''}`;

/** يحذف التكرار داخل المنطقة الواحدة — لا أثر له في التسعير، ويُربك العرض */
export function dedupeRegions(rows: readonly RegionShape[]): RegionShape[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = regionKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const level = (r: RegionShape): 1 | 2 | 3 => (r.city ? 3 : r.region ? 2 : 1);

/**
 * هل يطابق السطران عنواناً واحداً **بالدقّة نفسها**؟ حينها تتعادل المنطقتان
 * في `quoteShipping` ويفوز أيّهما جاء أولاً — أي سعر عشوائي للمشتري.
 *
 * المدينة مع محافظة فارغة تطابق أيّ محافظة، فتتعادل مع المدينة نفسها في
 * أيّ محافظة. أمّا اختلاف الدقّة فليس تعارضاً: الأدقّ يفوز، وهذا مقصود.
 */
export function ties(a: RegionShape, b: RegionShape): boolean {
  if (a.country !== b.country || level(a) !== level(b)) return false;
  switch (level(a)) {
    case 1:
      return true;
    case 2:
      return a.region === b.region;
    case 3:
      return a.city === b.city && (a.region === null || b.region === null || a.region === b.region);
  }
}

export const describeRegion = (r: RegionShape): string => [r.city, r.region, r.country].filter(Boolean).join('، ');

/** أوّل تعادل بين تغطية منطقة وتغطيات مناطق مفعّلة أخرى — أو null */
export function findTie(
  mine: readonly RegionShape[],
  others: readonly { nameAr: string; regions: readonly RegionShape[] }[],
): { region: RegionShape; zoneName: string } | null {
  for (const r of mine) {
    for (const z of others) {
      if (z.regions.some((o) => ties(r, o))) return { region: r, zoneName: z.nameAr };
    }
  }
  return null;
}

/**
 * تسعيرة كاملة الشكل. الحقل الذي لا تقرؤه الطريقة مرفوض لا مُهمَل:
 * «حسب الوزن» بلا سعر للكيلو كانت ستُحسب سعراً ثابتاً دون أن يعرف البائع.
 */
export function validateRate(r: {
  method: string;
  priceMinor: bigint;
  perKgMinor: bigint | null;
  freeOverMinor: bigint | null;
  minDays: number;
  maxDays: number;
}): RateShape {
  if (!(RATE_METHODS as readonly string[]).includes(r.method)) {
    throw new ShapeError('طريقة التسعير: سعر ثابت أو حسب الوزن أو مجاني فوق مبلغ.', 'method');
  }
  const method = r.method as RateMethod;
  const money = [r.priceMinor, r.perKgMinor, r.freeOverMinor];
  if (money.some((v) => v !== null && v < 0n)) throw new ShapeError('المبالغ لا تكون سالبة.', 'priceMinorUnits');

  if (method === 'by_weight') {
    if (r.perKgMinor === null || r.perKgMinor <= 0n) {
      throw new ShapeError('التسعير حسب الوزن يحتاج سعراً للكيلوغرام أكبر من صفر.', 'perKgMinorUnits');
    }
  } else if (r.perKgMinor !== null) {
    throw new ShapeError('سعر الكيلوغرام يخصّ التسعير حسب الوزن وحده.', 'perKgMinorUnits');
  }

  if (method === 'free_over') {
    if (r.freeOverMinor === null || r.freeOverMinor <= 0n) {
      throw new ShapeError('«مجاني فوق مبلغ» يحتاج حدّاً أكبر من صفر.', 'freeOverMinorUnits');
    }
  } else if (r.freeOverMinor !== null) {
    throw new ShapeError('حدّ الشحن المجاني يخصّ طريقة «مجاني فوق مبلغ» وحدها.', 'freeOverMinorUnits');
  }

  for (const [k, v] of [['minDays', r.minDays], ['maxDays', r.maxDays]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > MAX_DAYS) {
      throw new ShapeError(`مدّة التوصيل عدد أيام صحيح بين 0 و ${MAX_DAYS}.`, k);
    }
  }
  if (r.maxDays < 1) throw new ShapeError('نهاية مدّة التوصيل يوم واحد على الأقل.', 'maxDays');
  if (r.minDays > r.maxDays) {
    throw new ShapeError(`نهاية المدى يجب أن تكون مساوية أو أكبر من بدايته (${r.minDays} أيام).`, 'maxDays');
  }
  return { method, priceMinor: r.priceMinor, perKgMinor: r.perKgMinor, freeOverMinor: r.freeOverMinor, minDays: r.minDays, maxDays: r.maxDays };
}
