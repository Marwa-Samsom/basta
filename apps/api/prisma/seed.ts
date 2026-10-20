/**
 * بذور بسطة — القيم المؤسِّسة التي حسمتها المرحلة 01.
 * عديمة الأثر عند التكرار: تشغيلها مرتين لا يضاعف شيئاً.
 *
 * **تُنشئ ما غاب ولا تكتب فوق ما وُجد.** كل ما هنا تحرّره الإدارة بعد الإطلاق —
 * الإعدادات والعملات والسمات وقيمها. كانت upsert تكتب القيمة
 * المؤسِّسة فوق الحيّة، فتشغيل البذور في الإنتاج (خطوة في قائمة الإطلاق) يعيد
 * العمولة وفترة التعليق والحدّ الأدنى للسحب إلى افتراضها بصمت. تغيير قيمة قائمة
 * مكانه اللوحة أو مهاجرة صريحة، لا البذور.
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
  ['suspension_payout_hold_days', 90],       // القرار الملزم 13 — حجز احترازي للمعلَّق، 20 أكتوبر 2026
  ['return_window_days',          14],       // Q-08
  ['reservation_ttl_minutes',     15],       // ADR-006
  ['vendor_accept_timeout_hours', 48],       // Q-07
  ['default_commission_bps',      1000],     // Q-01
  ['cart_expiry_hours',           168],
  ['payment_reconcile_minutes',   10],
  ['base_currency',               'USD'],    // ADR-013
  ['fx_spread_bps',               200],      // Q-13
  ['default_display_currency',    'JOD'],    // عملة الزائر الجديد — 18 أكتوبر 2026
  ['coupon_default_funded_by',    'platform'], // Q-06
  ['transfer_window_hours',       48],       // الدفع بتحويل يدوي — UX-OPS-AUDIT البند 8
] as const;

// مكتبة سمات تكفي لمنتج حقيقي بمتغيّرات — متاحة لكل منتج بلا فئة

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

/**
 * صفحات المحتوى التي يربطها تذييل المتجر وصفحة الخطأ بمعرّفها (apps/web/src/app/(store)/layout.tsx).
 * غيابها كان يعطي 404 لكل رابط في التذييل. تحرّرها الإدارة بعدها من /admin/pages —
 * والأرقام هنا تطابق الإعدادات أعلاه (نافذة الإرجاع، مهلة قبول التاجر).
 */
const CMS_PAGES = [
  {
    slug: 'about',
    titleAr: 'من نحن',
    bodyAr: [
      'بسطة سوق إلكتروني يجمع المتاجر المستقلة في مكان واحد: تتصفّح منتجات تجّار كثيرين، وتدفع مرة واحدة، ويصلك كل طلب من متجره.',
      'كل تاجر على بسطة يمرّ بمراجعة قبل أن يبدأ البيع، وكل منتج يُراجَع قبل نشره. نريد أن تعرف ممّن تشتري، وأن يعرف التاجر أن السوق يحميه كما يحميك.',
      'أموالك محفوظة حتى تستلم طلبك وتنقضي فترة الإرجاع، ثم تصل إلى التاجر. وإن حدثت مشكلة فهناك نزاع تفتحه مع التاجر، وفريق يفصل فيه إن صعّدته.',
    ].join('\n\n'),
  },
  {
    slug: 'faq',
    titleAr: 'الأسئلة الشائعة',
    bodyAr: [
      'كيف أطلب من أكثر من متجر؟\nأضف ما تريد إلى السلة من أي متجر وادفع مرة واحدة. يُقسَّم طلبك على المتاجر، ويشحن كل متجر نصيبه، وتتابع كل جزء من صفحة الطلب.',
      'متى يُشحن طلبي؟\nأمام التاجر 48 ساعة ليقبل الطلب. إن لم يقبله خلالها أُلغي تلقائياً وأُعيد إليك المبلغ.',
      'هل يمكنني إرجاع منتج؟\nنعم، خلال 14 يوماً من الاستلام. التفاصيل في سياسة الإرجاع.',
      'كيف أتواصل مع التاجر؟\nمن صفحة الطلب أو من «رسائلي» في حسابك. الرسائل تبقى داخل بسطة، فتكون مرجعاً إن احتجت إلى فتح نزاع.',
      'أريد أن أبيع على بسطة، من أين أبدأ؟\nسجّل متجرك من «سجّل متجرك» في أسفل الصفحة. نراجع الطلب، وبعد الموافقة تضيف منتجاتك من لوحة التاجر.',
    ].join('\n\n'),
  },
  {
    slug: 'contact',
    titleAr: 'اتصل بنا',
    bodyAr: [
      'لسؤال عن طلب، تواصل مع التاجر مباشرة من صفحة الطلب أو من «رسائلي» في حسابك — هو الأقدر على الردّ عن الشحن والمنتج.',
      'إن لم يُحلّ الأمر، افتح نزاعاً من صفحة الطلب. يردّ عليك التاجر داخل النزاع، وإن لم يُرضِك ردّه صعّده إلى فريق بسطة ليفصل فيه.',
      'للتجّار: أسئلة الحساب والمستحقّات تجدها في لوحة التاجر.',
    ].join('\n\n'),
  },
  {
    slug: 'returns',
    titleAr: 'سياسة الإرجاع',
    bodyAr: [
      'يمكنك طلب إرجاع أي منتج خلال 14 يوماً من استلامه، من صفحة الطلب في حسابك.',
      'يُرسَل طلب الإرجاع إلى المتجر الذي شحن المنتج، ويُعاد إليك المبلغ فور استلامه القطع.',
      'إن رُفض طلبك ورأيت الرفض غير عادل، افتح نزاعاً من صفحة الطلب، ويمكنك تصعيده إلى فريق بسطة ليفصل فيه.',
      'أموال الطلب لا تصل إلى التاجر قبل أن تنقضي فترة الإرجاع، فحقّك في الاسترداد محفوظ طوال هذه المدة.',
    ].join('\n\n'),
  },
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

  // العمولة نسبة عامة على كل منتج يُباع، ونسبة خاصة لمتجر تُحدَّد من اللوحة (14 أكتوبر 2026)
  console.log('▸ العمولة العامة');
  const globalRule = await prisma.commissionRule.findFirst({
    where: { scope: 'global', effectiveTo: null },
  });
  if (!globalRule) {
    await prisma.commissionRule.create({
      data: { scope: 'global', rateBps: 1000, effectiveFrom: new Date('2026-01-01') },
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

  console.log('▸ صفحات المحتوى');
  for (const p of CMS_PAGES) {
    await prisma.cmsPage.upsert({ where: { slug: p.slug }, update: {}, create: { ...p, isPublished: true } });
  }

  console.log('✔ اكتملت البذور');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
