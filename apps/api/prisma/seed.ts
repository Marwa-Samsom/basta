/**
 * بذور بسطة — القيم المؤسِّسة التي حسمتها المرحلة 01.
 * عديمة الأثر عند التكرار: تشغيلها مرتين لا يضاعف شيئاً.
 */
import { PrismaClient } from '@prisma/client';

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

async function main() {
  console.log('▸ العملات');
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }

  console.log('▸ الإعدادات');
  for (const [key, value] of SETTINGS) {
    await prisma.setting.upsert({
      where: { key },
      update: { valueJson: value as never },
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
      update: { nameAr: c.nameAr },
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

  console.log('✔ اكتملت البذور');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
