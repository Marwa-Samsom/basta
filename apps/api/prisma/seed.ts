/**
 * بذور بسطة — القيم المؤسِّسة التي حسمتها المرحلة 01.
 * عديمة الأثر عند التكرار: تشغيلها مرتين لا يضاعف شيئاً.
 *
 * **تُنشئ ما غاب ولا تكتب فوق ما وُجد.** كل ما هنا تحرّره الإدارة بعد الإطلاق —
 * الإعدادات والعملات وأسماء الفئات والسمات وإلزاميتها. كانت upsert تكتب القيمة
 * المؤسِّسة فوق الحيّة، فتشغيل البذور في الإنتاج (خطوة في قائمة الإطلاق) يعيد
 * العمولة وفترة التعليق والحدّ الأدنى للسحب إلى افتراضها بصمت. تغيير قيمة قائمة
 * مكانه اللوحة أو مهاجرة صريحة، لا البذور.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

// Q-14: سبع عملات معتمدة. لاحظ اختلاف minorUnitDigits — ADR-013
const CURRENCIES = [
  { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar',      symbol: '$',   minorUnitDigits: 2, minPayoutMinorUnits: 5_000n,     isBase: true,  sort: 1 },
  { code: 'SAR', nameAr: 'ريال سعودي',   nameEn: 'Saudi Riyal',    symbol: '﷼',   minorUnitDigits: 2, minPayoutMinorUnits: 18_750n,    isBase: false, sort: 2 },
  { code: 'AED', nameAr: 'درهم إماراتي', nameEn: 'UAE Dirham',     symbol: 'د.إ', minorUnitDigits: 2, minPayoutMinorUnits: 18_000n,    isBase: false, sort: 3 },
  { code: 'JOD', nameAr: 'دينار أردني',  nameEn: 'Jordanian Dinar',symbol: 'د.أ', minorUnitDigits: 3, minPayoutMinorUnits: 35_000n,    isBase: false, sort: 4 },
  { code: 'KWD', nameAr: 'دينار كويتي',  nameEn: 'Kuwaiti Dinar',  symbol: 'د.ك', minorUnitDigits: 3, minPayoutMinorUnits: 15_000n,    isBase: false, sort: 5 },
  { code: 'EGP', nameAr: 'جنيه مصري',    nameEn: 'Egyptian Pound', symbol: 'ج.م', minorUnitDigits: 2, minPayoutMinorUnits: 240_000n,   isBase: false, sort: 6 },
  { code: 'EUR', nameAr: 'يورو',         nameEn: 'Euro',           symbol: '€',   minorUnitDigits: 2, minPayoutMinorUnits: 4_500n,     isBase: false, sort: 7 },
];

// Q-04: لكل بلد قاعدته. لا إعداد ضريبة عام واحد في المنصة.
const TAX_RATES = [
  { country: 'SA', rateBps: 1500, isPriceInclusive: false },
  { country: 'AE', rateBps:  500, isPriceInclusive: false },
  { country: 'JO', rateBps: 1600, isPriceInclusive: true  },
  { country: 'EG', rateBps: 1400, isPriceInclusive: true  },
  { country: 'KW', rateBps:    0, isPriceInclusive: true  },
];

const SETTINGS = [
  ['hold_period_days',            14],       // ADR-007
  ['return_window_days',          14],       // Q-08
  ['reservation_ttl_minutes',     15],       // ADR-006
  ['vendor_accept_timeout_hours', 48],       // Q-07
  ['default_commission_bps',      1000],     // Q-01
  ['cart_expiry_hours',           168],
  ['payment_reconcile_minutes',   10],
  ['base_currency',               'USD'],    // ADR-013
  ['fx_spread_bps',               200],      // Q-13
  ['coupon_default_funded_by',    'platform'], // Q-06
] as const;

// Q-01: شبكة العمولات الفئوية فوق القاعدة العامة
const CATEGORIES = [
  { slug: 'electronics', nameAr: 'إلكترونيات وأجهزة', commissionBps:  600 },
  { slug: 'fashion',     nameAr: 'ملابس وأحذية',      commissionBps: 1200 },
  { slug: 'beauty',      nameAr: 'جمال وعناية',        commissionBps: 1200 },
  { slug: 'home',        nameAr: 'منزل ومطبخ',         commissionBps: 1000 },
  { slug: 'grocery',     nameAr: 'بقالة ومواد غذائية', commissionBps:  500 },
  { slug: 'handmade',    nameAr: 'يدويّات وحرف',       commissionBps:  800 },
];

// المرحلة 05: سمات تكفي لمنتج حقيقي بمتغيّرات، وفروع تثبت أن الشجرة متعددة المستويات
const SUBCATEGORIES = [
  { parent: 'fashion', slug: 'men-clothing', nameAr: 'ملابس رجالية', nameEn: "Men's clothing" },
  { parent: 'fashion', slug: 'women-clothing', nameAr: 'ملابس نسائية', nameEn: "Women's clothing" },
  { parent: 'electronics', slug: 'phones', nameAr: 'هواتف ذكية', nameEn: 'Smartphones' },
];

/** [الاسم العربي، الإنجليزي، اللون] */
type ValueSeed = readonly [valueAr: string, valueEn: string, hexColor?: string];

interface AttributeSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  inputType: 'select' | 'text' | 'number' | 'boolean';
  unit?: string;
  isVariantAxis: boolean;
  sort: number;
  values: readonly ValueSeed[];
}

const ATTRIBUTES: readonly AttributeSeed[] = [
  {
    code: 'color', nameAr: 'اللون', nameEn: 'Color', inputType: 'select', isVariantAxis: true, sort: 1,
    values: [
      ['أحمر', 'Red', '#C62828'], ['أزرق', 'Blue', '#1565C0'], ['أسود', 'Black', '#212121'],
      ['أبيض', 'White', '#FAFAFA'], ['أخضر', 'Green', '#2E7D32'], ['رمادي', 'Grey', '#757575'],
      ['بيج', 'Beige', '#D7CCC8'],
    ],
  },
  {
    code: 'size', nameAr: 'المقاس', nameEn: 'Size', inputType: 'select', isVariantAxis: true, sort: 2,
    values: [['XS', 'XS'], ['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL'], ['XXL', 'XXL']],
  },
  {
    code: 'storage', nameAr: 'السعة التخزينية', nameEn: 'Storage', inputType: 'select', isVariantAxis: true, sort: 3,
    values: [['64 GB', '64 GB'], ['128 GB', '128 GB'], ['256 GB', '256 GB'], ['512 GB', '512 GB']],
  },
  { code: 'material', nameAr: 'الخامة', nameEn: 'Material', inputType: 'text', isVariantAxis: false, sort: 4, values: [] },
  {
    code: 'warranty_months', nameAr: 'مدة الضمان', nameEn: 'Warranty', inputType: 'number', unit: 'شهر',
    isVariantAxis: false, sort: 5, values: [],
  },
];

// [فئة، سمة، إلزامية] — الفروع ترث سمات أصولها
const CATEGORY_ATTRIBUTES: readonly (readonly [slug: string, code: string, isRequired: boolean])[] = [
  ['fashion', 'color', false],
  ['fashion', 'size', false],
  ['fashion', 'material', true],
  ['electronics', 'color', false],
  ['electronics', 'storage', false],
  ['electronics', 'warranty_months', false],
];

async function main() {
  console.log('▸ العملات');
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  /**
   * أسعار الصرف من العملة الأساس (USD) — ADR-013. للإضافة فقط: السعر الجديد
   * سطر جديد بتاريخ نفاذه، والطلب يلقط السعر النافذ لحظة الدفع. القيم هنا
   * أسعار تطوير ثابتة؛ مصدر حيّ يُوصل في المرحلة 12.
   */
  console.log('▸ أسعار الصرف');
  const FX: readonly (readonly [string, string])[] = [
    ['SAR', '3.7500000000'],
    ['AED', '3.6725000000'],
    ['JOD', '0.7090000000'],
    ['KWD', '0.3070000000'],
    ['EGP', '48.5000000000'],
    ['EUR', '0.9200000000'],
    ['USD', '1.0000000000'],
  ];
  for (const [quote, rate] of FX) {
    const existing = await prisma.exchangeRate.findFirst({ where: { baseCode: 'USD', quoteCode: quote } });
    if (!existing) {
      await prisma.exchangeRate.create({
        data: { baseCode: 'USD', quoteCode: quote, rate, source: 'seed', effectiveAt: new Date('2026-01-01') },
      });
    }
  }

  console.log('▸ الإعدادات');
  for (const [key, value] of SETTINGS) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, valueJson: value as never },
    });
  }

  console.log('▸ الضرائب');
  for (const t of TAX_RATES) {
    const existing = await prisma.taxRate.findFirst({
      where: { country: t.country, region: null },
    });
    if (!existing) {
      await prisma.taxRate.create({ data: { ...t, effectiveFrom: new Date('2026-01-01') } });
    }
  }

  console.log('▸ الفئات وقواعد العمولة');
  for (const [i, c] of CATEGORIES.entries()) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { slug: c.slug, nameAr: c.nameAr, path: `/${i + 1}/`, depth: 0, sort: i },
    });
    const rule = await prisma.commissionRule.findFirst({
      where: { scope: 'category', categoryId: cat.id, effectiveTo: null },
    });
    if (!rule) {
      await prisma.commissionRule.create({
        data: {
          scope: 'category',
          categoryId: cat.id,
          rateBps: c.commissionBps,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
  }

  const globalRule = await prisma.commissionRule.findFirst({
    where: { scope: 'global', effectiveTo: null },
  });
  if (!globalRule) {
    await prisma.commissionRule.create({
      data: { scope: 'global', rateBps: 1000, effectiveFrom: new Date('2026-01-01') },
    });
  }

  console.log('▸ الفئات الفرعية');
  for (const [i, c] of SUBCATEGORIES.entries()) {
    const parent = await prisma.category.findUniqueOrThrow({ where: { slug: c.parent } });
    const existing = await prisma.category.findUnique({ where: { slug: c.slug } });
    if (existing) continue;
    const id = randomUUID();
    await prisma.category.create({
      data: {
        id, parentId: parent.id, path: `${parent.path}${id}/`, depth: parent.depth + 1,
        slug: c.slug, nameAr: c.nameAr, nameEn: c.nameEn, sort: i,
      },
    });
  }

  console.log('▸ السمات وقيمها');
  for (const a of ATTRIBUTES) {
    const { values, ...fields } = a;
    const attribute = await prisma.attribute.upsert({ where: { code: a.code }, update: {}, create: fields });
    const known = new Set(
      (await prisma.attributeValue.findMany({ where: { attributeId: attribute.id }, select: { valueAr: true } }))
        .map((v) => v.valueAr),
    );
    for (const [sort, [valueAr, valueEn, hexColor]] of values.entries()) {
      if (known.has(valueAr)) continue;
      await prisma.attributeValue.create({
        data: { attributeId: attribute.id, valueAr, valueEn: valueEn ?? null, hexColor: hexColor ?? null, sort },
      });
    }
  }

  console.log('▸ ربط السمات بالفئات');
  for (const [slug, code, isRequired] of CATEGORY_ATTRIBUTES) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug } });
    const attribute = await prisma.attribute.findUniqueOrThrow({ where: { code } });
    await prisma.categoryAttribute.upsert({
      where: { categoryId_attributeId: { categoryId: category.id, attributeId: attribute.id } },
      update: {},
      create: { categoryId: category.id, attributeId: attribute.id, isRequired },
    });
  }

  console.log('✔ اكتملت البذور');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
