import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { like, folded } from '../../../common/paging';
import { NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InventoryService } from '../../inventory/public';
import { DisplayCurrencyService, type DisplayFx } from '../../pricing/public';
import { SearchService, type SearchDocument, type SearchInput } from '../../search/public';
import { VendorEvents } from '../../vendors/public';
import { displayedPrice, priceView, type Page, type PriceView } from './views';

export interface StorefrontProductCard {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly price: PriceView;
  readonly compareAtPrice: PriceView | null;
  readonly vendor: { readonly id: string; readonly slug: string; readonly nameAr: string; readonly nameEn: string | null };
  readonly thumbnail: string | null;
  readonly available: number;
  readonly isSoldOut: boolean;
}

/** بطاقة متجر في دليل المتاجر */
export interface StorefrontShopCard {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly productCount: number;
  /** أوائل فئات المتجر بترتيبه — لمحة عمّا يبيع */
  readonly categories: readonly string[];
  /** الفئات نفسها بأسمائها الإنجليزية، والعربي لفئة بلا اسم إنجليزي */
  readonly categoriesEn: readonly string[];
}

export interface StorefrontShopsPage extends Page<StorefrontShopCard> {
  /** «متاجر قريبة من بحثك»: حين لا يطابق اسمٌ الجملة كاملة — ما في اسمه كلمة منها (DISC-075) */
  readonly suggestions: readonly StorefrontShopCard[];
}

export interface FacetBucket {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export interface StorefrontFacets {
  readonly brands: readonly FacetBucket[];
  readonly vendors: readonly FacetBucket[];
  readonly attributes: readonly {
    readonly attributeId: string;
    readonly nameAr: string;
    readonly values: readonly FacetBucket[];
  }[];
  /** بعملة العرض — أرخص وأغلى ما في النتيجة بعد التحويل */
  readonly priceRange: { readonly minMinor: string; readonly maxMinor: string; readonly currency: string } | null;
}

export interface StorefrontListResult extends Page<StorefrontProductCard> {
  readonly engine: 'meili' | 'db';
  readonly tookMs: number;
  readonly facets: StorefrontFacets;
}

/**
 * **قاعدة الرؤية — تُكتب مرة واحدة هنا ولا تُكرَّر.**
 *
 * منتج يظهر للمشتري إذا كان منشوراً وغير محذوف **وبائعه معتمد**. بائع معلَّق
 * تختفي منتجاته فوراً بلا تعديل صف واحد منها (بوابة المرحلة 06، البند الثاني)
 * — لأن الشرط على حالة البائع لا على نسخة محفوظة في المنتج.
 */
const VISIBLE: Prisma.ProductWhereInput = {
  status: 'active',
  deletedAt: null,
  vendor: { status: 'approved' },
  variants: { some: { archivedAt: null, isActive: true } },
};

const CARD_INCLUDE = {
  vendor: { select: { id: true, slug: true, nameAr: true, nameEn: true, settlementCurrency: true } },
  variants: {
    where: { archivedAt: null, isActive: true },
    select: { id: true, priceMinorUnits: true, compareAtPriceMinorUnits: true },
    orderBy: { priceMinorUnits: 'asc' as const },
  },
  images: { take: 1, orderBy: { sort: 'asc' as const }, select: { fileKey: true } },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof CARD_INCLUDE }>;

/**
 * الاسم كما يكتبه الناس — تطبيع محرّك البحث نفسه: الهمزات والمدّة ألفاً، والتاء المربوطة
 * هاءً، والألف المقصورة ياءً، بلا تشكيل ولا شدّة ولا تطويل. يُطبَّق على الطرفين في القاعدة
 * فلا يختلف تطبيعان.
 */
const MARKS = '[ً-ٰٟـ]';
const fold = (value: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`translate(regexp_replace(lower(${value}), ${MARKS}, '', 'g'), ${'أإآٱةى'}, ${'ااااهي'})`;

/**
 * كلمات تصف المتجر لا تسمّيه: «متجر الصوف» يُقترح له بـ«الصوف» وحدها، وإلا اقتُرح كل متجر في اسمه
 * «متجر». وما دون ثلاثة أحرف لا يميّز اسماً (DISC-075، 29 أكتوبر 2026)
 */
const GENERIC_SHOP_WORDS = new Set(['متجر', 'متاجر', 'محل', 'محلات', 'دكان']);
const SHOP_SUGGESTIONS = 6;

const SHOP_CARD_SELECT = {
  id: true,
  slug: true,
  nameAr: true,
  nameEn: true,
  descriptionAr: true,
  descriptionEn: true,
  ratingAvg: true,
  ratingCount: true,
  _count: { select: { products: { where: VISIBLE } } },
  // الفئة الفارغة لا تقول شيئاً عمّا يبيع المتجر
  categories: {
    where: { products: { some: VISIBLE } },
    orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    take: 4,
    select: { nameAr: true, nameEn: true },
  },
} satisfies Prisma.VendorSelect;

const shopCard = (v: Prisma.VendorGetPayload<{ select: typeof SHOP_CARD_SELECT }>): StorefrontShopCard => ({
  id: v.id,
  slug: v.slug,
  nameAr: v.nameAr,
  nameEn: v.nameEn,
  descriptionAr: v.descriptionAr,
  descriptionEn: v.descriptionEn,
  ratingAvg: Number(v.ratingAvg),
  ratingCount: v.ratingCount,
  productCount: v._count.products,
  categories: v.categories.map((c) => c.nameAr),
  categoriesEn: v.categories.map((c) => c.nameEn ?? c.nameAr),
});

@Injectable()
export class StorefrontService implements OnModuleInit {
  private readonly logger = new Logger('Storefront');

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly search: SearchService,
    private readonly vendorEvents: VendorEvents,
    private readonly display: DisplayCurrencyService,
  ) {}

  /** تعليق متجر أو رفعه أو اعتماده يغيّر ظهور منتجاته كلها — الفهرس يتبعه فوراً */
  onModuleInit(): void {
    this.vendorEvents.onVisibilityChanged((vendorId) => this.syncVendor(vendorId));
    // متاح الوثيقة يتبع المخزون — تعديل البائع والحجز والبيع والإرجاع — وإلا كذب «المتوفّر فقط» (DISC-026)
    this.inventory.onAvailabilityChanged((variantIds) => this.syncVariants(variantIds));
    // الاختبار يبني فهرسه بنفسه؛ مزامنة خلفية تسابقه (NODE_ENV فيه development من .env)
    if (!process.env['VITEST']) void this.backfillIndex();
  }

  /**
   * فهرس بُني قبل حقل جديد يُكمَل عند الإقلاع بلا إعادة بناء يدوية: priceUsd (18 أكتوبر 2026)
   * وإلا رُتّب بالسعر خطأً بين العملات، و variantValueIds (31 أكتوبر) وإلا غاب وجه «اللون»
   * لمنتج ألوانه متغيّرات، و publishedAt (14 نوفمبر، DISC-029) وإلا رُتّب «الأحدث» بغير تاريخ
   * النشر. يُعاد كتابة المرئي فقط، ولا يمسح شيئاً.
   */
  private async backfillIndex(): Promise<void> {
    try {
      // حقل صار قابلاً للتصفية للتوّ لا يُسأل عنه قبل أن يُطبَّق الإعداد
      await this.search.ensureIndex();
      await this.search.idle(60_000);
      let missing = 0;
      for (const field of ['priceUsd', 'variantValueIds', 'publishedAt']) {
        missing = Math.max(missing, (await this.search.missing(field)) ?? 0);
      }
      if (!missing) return;
      const ids = (await this.prisma.product.findMany({ where: VISIBLE, select: { id: true } })).map((p) => p.id);
      for (let i = 0; i < ids.length; i += 500) await this.syncIndex(ids.slice(i, i + 500));
      this.logger.log(`أُكملت وثائق الفهرس لـ ${ids.length} منتجاً (كان ينقص ${missing})`);
    } catch (err) {
      this.logger.warn(`تعذّر إكمال الفهرس: ${(err as Error).message}`);
    }
  }

  /**
   * اقتراحات أثناء الكتابة — ST-06. أسماء من الفهرس، تمرّ بقاعدة الرؤية كما تمرّ
   * نتائج البحث (list): الفهرس نسخة قد تتأخّر — متجر عُلّق والمحرّك نائم، أو
   * كتابة لم تبلغه — فيقترح منتجاً لم يعد يُباع. القاعدة تقول الكلمة الأخيرة.
   */
  async suggest(term: string, limit = 6): Promise<string[]> {
    const hits = await this.search.suggestHits(term, limit * 2);
    if (hits.length === 0) return [];
    const visible = new Set(
      (await this.prisma.product.findMany({ where: { ...VISIBLE, id: { in: hits.map((h) => h.id) } }, select: { id: true } })).map((p) => p.id),
    );
    return [...new Set(hits.filter((h) => visible.has(h.id)).map((h) => h.nameAr))].slice(0, limit);
  }

  // ------------------------------------------------------------- القائمة

  /**
   * الأسعار بعملة العرض (displayCurrency، وإلا افتراضية الإدارة) — قرار 18 أكتوبر
   * 2026. وحدّا السعر بها أيضاً: يُحوَّلان لكل عملة متجر، ولدولار الفهرس.
   */
  async list(request: SearchInput): Promise<StorefrontListResult> {
    const started = Date.now();
    const page = Math.max(1, request.page ?? 1);
    const pageSize = Math.min(48, Math.max(1, request.pageSize ?? 24));
    const fx = await this.display.resolve(request.displayCurrency);
    const input: SearchInput = {
      ...request,
      displayCurrency: fx.currency,
      minPriceUsd: request.minPriceMinor !== undefined ? (fx.usdBound(request.minPriceMinor) ?? undefined) : undefined,
      maxPriceUsd: request.maxPriceMinor !== undefined ? (fx.usdBound(request.maxPriceMinor) ?? undefined) : undefined,
    };

    const hit = input.q?.trim() ? await this.search.search({ ...input, page, pageSize }) : null;

    if (hit) {
      // الفهرس قال من المرشّحون؛ التفاصيل والأسعار من القاعدة دائماً
      const [rows, seen] = await Promise.all([
        this.prisma.product.findMany({
          where: { ...VISIBLE, id: { in: [...hit.ids] } },
          include: CARD_INCLUDE,
        }),
        this.visibleMatches(hit.matches),
      ]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = hit.ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
      return {
        items: await this.cards(ordered, fx),
        page,
        pageSize,
        total: seen?.total ?? hit.total,
        engine: 'meili',
        tookMs: Date.now() - started,
        // الأوجه من توزيع المحرّك: عدّ القاعدة يتجاهل الكلمة المبحوث عنها
        facets: await this.facetsFromDistribution(seen ? { ...hit.facets, vendorId: seen.vendors } : hit.facets),
      };
    }

    const where = await this.whereOf(input, fx);
    const [rows, total] =
      input.sort === 'price_asc' || input.sort === 'price_desc'
        ? await this.byPrice(where, input.sort, fx, page, pageSize)
        : await Promise.all([
            this.prisma.product.findMany({
              where,
              include: CARD_INCLUDE,
              orderBy: this.orderOf(input.sort),
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            this.prisma.product.count({ where }),
          ]);

    return {
      items: await this.cards(rows, fx),
      page,
      pageSize,
      total,
      engine: 'db',
      tookMs: Date.now() - started,
      facets: await this.facets(input, fx),
    };
  }

  private orderOf(sort: SearchInput['sort']): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'newest':
        return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
      // الصلة لا تُحسب في القاعدة: الأحدث كي لا تكذب على المستخدم بترتيب عشوائي
      default:
        return [{ publishedAt: 'desc' }];
    }
  }

  /**
   * الترتيب بالسعر في القاعدة — كما يرتّب المحرّك: أرخص متغيّر حيّ بالدولار (priceUsd)، فعشرة دنانير
   * أغلى من عشرين ريالاً، وما لا سعر صرف له في الآخر، والأحدث نشراً عند التساوي. السعر على المتغيّر
   * لا المنتج فلا يرتّبه orderBy: تُقرأ المطابقات خفيفةً (معرّف وعملة وأرخص سعر) ثم الصفحة وحدها
   * بتفاصيلها. كان مسار القاعدة — تصفّح المتجر بلا كلمة وسقوط المحرّك — يرتّب بالأحدث دائماً (DISC-034).
   */
  private async byPrice(
    where: Prisma.ProductWhereInput,
    sort: 'price_asc' | 'price_desc',
    fx: DisplayFx,
    page: number,
    pageSize: number,
  ): Promise<[CardRow[], number]> {
    const matches = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        publishedAt: true,
        vendor: { select: { settlementCurrency: true } },
        variants: { where: { archivedAt: null, isActive: true }, select: { priceMinorUnits: true }, orderBy: { priceMinorUnits: 'asc' }, take: 1 },
      },
    });
    const direction = sort === 'price_asc' ? 1 : -1;
    const keyed = matches.map((m) => ({
      id: m.id,
      usd: fx.usd(m.variants[0]?.priceMinorUnits ?? 0n, m.vendor.settlementCurrency),
      published: m.publishedAt?.getTime() ?? 0,
    }));
    keyed.sort((x, y) => {
      if (x.usd === null || y.usd === null) return x.usd === y.usd ? y.published - x.published : x.usd === null ? 1 : -1;
      return (x.usd - y.usd) * direction || y.published - x.published;
    });
    const ids = keyed.slice((page - 1) * pageSize, page * pageSize).map((k) => k.id);
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids } }, include: CARD_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return [ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), matches.length];
  }

  private async whereOf(input: SearchInput, fx: DisplayFx): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [VISIBLE];

    if (input.vendorId) and.push({ vendorId: input.vendorId });
    if (input.storeCategoryId) and.push({ vendorCategoryId: input.storeCategoryId });
    if (input.brandId) and.push({ brandId: input.brandId });

    const term = input.q?.trim();
    if (term) {
      // السقوط من المحرّك: تطابق نصّي بسيط — أضعف تسامحاً، وأفضل من لا نتيجة
      and.push({
        OR: [
          { nameArFold: folded(term) },
          { nameEn: like(term) },
          { descriptionArFold: folded(term) },
        ],
      });
    }

    // القيمة خاصّية للمنتج، أو محور في أحد متغيّراته الحيّة: «أحمر» قميصٌ أحد ألوانه أحمر
    for (const valueId of input.attributeValueIds ?? []) {
      and.push({
        OR: [
          { attrValues: { some: { attributeValueId: valueId } } },
          { variants: { some: { archivedAt: null, isActive: true, optionValues: { some: { attributeValueId: valueId } } } } },
        ],
      });
    }

    if (input.minPriceMinor !== undefined || input.maxPriceMinor !== undefined) {
      and.push({ OR: await this.priceBounds(input.minPriceMinor, input.maxPriceMinor, fx) });
    }

    // «المتوفّر فقط» كما في المحرّك (available > 0): متغيّر حيّ واحد على الأقل متاحه موجب (DISC-034)
    if (input.inStockOnly) {
      and.push({
        variants: { some: { archivedAt: null, isActive: true, inventory: { is: { onHand: { gt: this.prisma.inventory.fields.reserved } } } } },
      });
    }

    return { AND: and };
  }

  /**
   * حدّا السعر بعملة العرض، محوَّلين إلى عملة كل متجر بعكس معامل العرض نفسه:
   * المعروض round(س × م) ≥ الأدنى ⇔ س ≥ ⌈(الأدنى − ½) ÷ م⌉، و ≤ الأعلى ⇔
   * س ≤ ⌈(الأعلى + ½) ÷ م⌉ − 1. والحدّان في مرشّح متغيّر واحد: كانا مفتاحين
   * منفصلين فيكتب الثاني فوق الأول، ومن حدّد الأدنى والأعلى معاً رأى ما تحت الأدنى.
   */
  private async priceBounds(min: number | undefined, max: number | undefined, fx: DisplayFx): Promise<Prisma.ProductWhereInput[]> {
    const currencies = (
      await this.prisma.vendor.findMany({ distinct: ['settlementCurrency'], select: { settlementCurrency: true } })
    ).map((v) => v.settlementCurrency);
    const out: Prisma.ProductWhereInput[] = [];
    for (const currency of currencies) {
      const f = fx.factor(currency);
      if (f === null) continue; // بلا سعر صرف لا يُقارن بعملة العرض
      const price: Prisma.BigIntFilter = {
        ...(min !== undefined ? { gte: f === 1 ? BigInt(min) : BigInt(Math.max(0, Math.ceil((min - 0.5) / f))) } : {}),
        ...(max !== undefined ? { lte: f === 1 ? BigInt(max) : BigInt(Math.ceil((max + 0.5) / f) - 1) } : {}),
      };
      out.push({
        vendor: { settlementCurrency: currency },
        variants: { some: { archivedAt: null, isActive: true, priceMinorUnits: price } },
      });
    }
    // لا عملة تُقارن: لا نتيجة، لا كل شيء
    return out.length > 0 ? out : [{ id: { in: [] } }];
  }

  /**
   * المنتجات المميّزة بترتيب الإدارة (AD-19). قاعدة الرؤية نفسها: منتج صار
   * مخفياً بعد تمييزه يسقط من القسم بصمت ولا يظهر مكسوراً.
   */
  async featured(currency?: string): Promise<StorefrontProductCard[]> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'home_featured_product_ids' } });
    const ids = Array.isArray(row?.valueJson) ? (row.valueJson as string[]) : [];
    return this.cardsByIds(ids, currency);
  }

  /**
   * بطاقات منتجات بترتيب المعرّفات المعطاة، بقاعدة الرؤية نفسها — للمميّز
   * ولحملات الرئيسية (AD-17): ما صار مخفياً يسقط بصمت ولا يظهر مكسوراً.
   */
  async cardsByIds(ids: readonly string[], currency?: string): Promise<StorefrontProductCard[]> {
    if (ids.length === 0) return [];
    const [rows, fx] = await Promise.all([
      this.prisma.product.findMany({ where: { ...VISIBLE, id: { in: [...ids] } }, include: CARD_INCLUDE }),
      this.display.resolve(currency),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.cards(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), fx);
  }

  /**
   * خريطة الموقع — المرحلة 12. ما يُفهرس هو ما يراه الزائر: قاعدة الرؤية
   * نفسها للمنتجات، والمتاجر المعتمدة، والصفحات المنشورة.
   */
  async sitemap() {
    const [products, shops, pages] = await Promise.all([
      this.prisma.product.findMany({ where: VISIBLE, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 45_000 }),
      this.prisma.vendor.findMany({ where: { status: 'approved' }, select: { slug: true, updatedAt: true }, take: 5_000 }),
      this.prisma.cmsPage.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true } }),
    ]);
    return { products, shops, pages };
  }

  /**
   * دليل المتاجر — حلّ محلّ «كل الأقسام» حين صارت الفئات لكل متجر (14 أكتوبر 2026).
   * المعتمد الذي له منتج معروض وحده: متجر فارغ صفحة بلا شيء.
   */
  async shops(input: { q?: string | undefined; page?: number | undefined }): Promise<StorefrontShopsPage> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = 24;
    const term = input.q?.trim();
    const where: Prisma.VendorWhereInput = {
      status: 'approved',
      products: { some: VISIBLE },
      ...(term ? { id: { in: await this.shopIdsByName(term) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.vendor.findMany({
        where,
        orderBy: [{ ratingCount: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SHOP_CARD_SELECT,
      }),
      this.prisma.vendor.count({ where }),
    ]);
    const suggestions = term && total === 0 ? await this.nearShops(term) : [];
    return { page, pageSize, total, items: rows.map(shopCard), suggestions };
  }

  /**
   * «متاجر قريبة من بحثك»: ما في اسمه كلمة مميّزة من البحث، الأكثر كلماتٍ أولاً (DISC-075). كان
   * «متجر الصوف» ينتهي بـ«لا متجر» ولا يدلّ على «بيت الصوف».
   */
  private async nearShops(term: string): Promise<StorefrontShopCard[]> {
    const words = [...new Set(term.split(/\s+/))].filter((w) => w.length >= 3 && !GENERIC_SHOP_WORDS.has(w.replace(/^ال/, '')));
    if (words.length === 0) return [];
    const name = fold(Prisma.raw('"nameAr"'));
    const score = Prisma.join(
      words.map((w) => Prisma.sql`(strpos(${name}, ${fold(Prisma.sql`${w}::text`)}) > 0)::int`),
      ' + ',
    );
    const ranked = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM (SELECT id, ${score} AS score, "ratingCount", "createdAt" FROM vendors WHERE status = 'approved') v
      WHERE score > 0
      ORDER BY score DESC, "ratingCount" DESC, "createdAt" ASC`;
    if (ranked.length === 0) return [];
    const rows = await this.prisma.vendor.findMany({
      where: { id: { in: ranked.map((r) => r.id) }, status: 'approved', products: { some: VISIBLE } },
      select: SHOP_CARD_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ranked.flatMap((r) => (byId.has(r.id) ? [shopCard(byId.get(r.id)!)] : [])).slice(0, SHOP_SUGGESTIONS);
  }

  /**
   * البحث في الدليل باسم المتجر كما يُكتب، كبحث المنتجات (DISC-038، 26 أكتوبر 2026):
   * كان مطابقة حرفية فلا تجد «اخفاء» متجر «إخفاء»، ولا «دليل ا» متجر «دليل أ».
   */
  private async shopIdsByName(term: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM vendors
      WHERE status = 'approved' AND strpos(${fold(Prisma.raw('"nameAr"'))}, ${fold(Prisma.sql`${term}::text`)}) > 0`;
    return rows.map((r) => r.id);
  }

  private async cards(rows: readonly CardRow[], fx: DisplayFx): Promise<StorefrontProductCard[]> {
    const levels = new Map(
      (await this.inventory.levels(rows.flatMap((r) => r.variants.map((v) => v.id)))).map((l) => [
        l.variantId,
        l,
      ]),
    );

    return rows.map((r) => {
      const cheapest = r.variants[0];
      const available = r.variants.reduce(
        (sum, v) => sum + (levels.get(v.id)?.available ?? 0),
        0,
      );
      // سعر المنتج بعملة تسوية بائعه (ADR-013)، ويُعرض بعملة المشتري
      const currency = r.vendor.settlementCurrency;
      return {
        id: r.id,
        slug: r.slug,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        price: displayedPrice(fx, cheapest?.priceMinorUnits ?? 0n, currency).price,
        compareAtPrice: cheapest?.compareAtPriceMinorUnits
          ? displayedPrice(fx, cheapest.compareAtPriceMinorUnits, currency).price
          : null,
        vendor: { id: r.vendor.id, slug: r.vendor.slug, nameAr: r.vendor.nameAr, nameEn: r.vendor.nameEn },
        thumbnail: r.images[0] ? `/uploads/${r.images[0].fileKey}/thumb.webp` : null,
        available,
        isSoldOut: available <= 0,
      };
    });
  }

  // -------------------------------------------------------------- الأوجه

  /**
   * المطابقات التي تقبلها قاعدة الرؤية، معدودةً لكل متجر. الفهرس قد يكون قديماً (مسودّة أو موقوف كُتب
   * والمحرّك نائم): كان وجه «المتجر» يعدّها من توزيع المحرّك فيظهر متجر بعدّ 2 ولا منتج له في النتائج
   * (DISC-035). null: المطابقات فوق حدّ التحقّق فيبقى توزيع المحرّك.
   */
  private async visibleMatches(
    matches: readonly { id: string; vendorId: string }[] | undefined,
  ): Promise<{ total: number; vendors: Record<string, number> } | null> {
    if (!matches) return null;
    const rows = matches.length
      ? await this.prisma.product.findMany({ where: { ...VISIBLE, id: { in: matches.map((m) => m.id) } }, select: { vendorId: true } })
      : [];
    const vendors: Record<string, number> = {};
    for (const r of rows) vendors[r.vendorId] = (vendors[r.vendorId] ?? 0) + 1;
    return { total: rows.length, vendors };
  }

  /**
   * أوجه البحث من توزيع المحرّك. المحرّك يعطي معرّفات وأعداداً، والأسماء
   * تُقرأ من القاعدة — والبائع غير المعتمد يسقط هنا كما يسقط من النتائج.
   */
  private async facetsFromDistribution(
    distribution: Readonly<Record<string, Readonly<Record<string, number>>>>,
  ): Promise<StorefrontFacets> {
    const vendorCounts = distribution['vendorId'] ?? {};
    const brandCounts = distribution['brandId'] ?? {};
    const valueCounts = distribution['attributeValueIds'] ?? {};

    const [vendors, brands, values] = await Promise.all([
      this.prisma.vendor.findMany({
        where: { id: { in: Object.keys(vendorCounts) }, status: 'approved' },
        select: { id: true, nameAr: true },
      }),
      this.prisma.brand.findMany({
        where: { id: { in: Object.keys(brandCounts) } },
        select: { id: true, nameAr: true },
      }),
      this.prisma.attributeValue.findMany({
        where: { id: { in: Object.keys(valueCounts) } },
        select: { id: true, valueAr: true, attributeId: true, attribute: { select: { nameAr: true } } },
      }),
    ]);

    const byAttribute = new Map<string, { nameAr: string; values: FacetBucket[] }>();
    for (const v of values) {
      const entry = byAttribute.get(v.attributeId) ?? { nameAr: v.attribute.nameAr, values: [] };
      entry.values.push({ id: v.id, label: v.valueAr, count: valueCounts[v.id] ?? 0 });
      byAttribute.set(v.attributeId, entry);
    }

    return {
      vendors: vendors
        .map((v) => ({ id: v.id, label: v.nameAr, count: vendorCounts[v.id] ?? 0 }))
        .sort((a, b) => b.count - a.count),
      brands: brands.map((b) => ({ id: b.id, label: b.nameAr, count: brandCounts[b.id] ?? 0 })),
      attributes: [...byAttribute.entries()].map(([attributeId, entry]) => ({
        attributeId,
        nameAr: entry.nameAr,
        values: entry.values.sort((a, b) => b.count - a.count),
      })),
      priceRange: null,
    };
  }

  /**
   * الأوجه تُحسب من القاعدة لا من الفهرس: العدّ يجب أن يطابق ما سيراه
   * المشتري إن ضغط الوجه، والفهرس قد يتأخّر لحظة عن القاعدة.
   */
  private async facets(input: SearchInput, fx: DisplayFx): Promise<StorefrontFacets> {
    const base = await this.whereOf({ ...input, attributeValueIds: [], q: undefined }, fx);

    const [brands, vendors, attrValues, axisRows] = await Promise.all([
      this.prisma.product.groupBy({
        by: ['brandId'],
        where: { ...base, brandId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.product.groupBy({ by: ['vendorId'], where: base, _count: { _all: true } }),
      this.prisma.productAttributeValue.groupBy({
        by: ['attributeValueId'],
        where: { product: base, attributeValueId: { not: null } },
        _count: { _all: true },
      }),
      // اللون والمقاس محوران في المتغيّرات لا خاصّيتان للمنتج (المحرّر لا يعرض المحور خاصّيةً)
      this.prisma.productVariant.findMany({
        where: { archivedAt: null, isActive: true, product: base, optionValues: { some: {} } },
        select: { productId: true, optionValues: { select: { attributeValueId: true } } },
      }),
    ]);

    // المنتج يُعدّ مرّة للقيمة ولو حملها ثلاثة من متغيّراته (أحمر S و M و L)
    const productsByValue = new Map<string, Set<string>>();
    for (const row of axisRows) {
      for (const { attributeValueId } of row.optionValues) {
        const products = productsByValue.get(attributeValueId) ?? new Set<string>();
        products.add(row.productId);
        productsByValue.set(attributeValueId, products);
      }
    }
    const valueCount = (id: string): number =>
      (attrValues.find((a) => a.attributeValueId === id)?._count._all ?? 0) + (productsByValue.get(id)?.size ?? 0);

    const [brandRows, vendorRows, valueRows] = await Promise.all([
      this.prisma.brand.findMany({
        where: { id: { in: brands.flatMap((b) => (b.brandId ? [b.brandId] : [])) } },
        select: { id: true, nameAr: true },
      }),
      this.prisma.vendor.findMany({
        where: { id: { in: vendors.map((v) => v.vendorId) } },
        select: { id: true, nameAr: true, settlementCurrency: true },
      }),
      this.prisma.attributeValue.findMany({
        where: { id: { in: [...attrValues.flatMap((a) => (a.attributeValueId ? [a.attributeValueId] : [])), ...productsByValue.keys()] } },
        select: { id: true, valueAr: true, attributeId: true, attribute: { select: { nameAr: true } } },
      }),
    ]);

    const priceRange = await this.priceRange(base, [...new Set(vendorRows.map((v) => v.settlementCurrency))], fx);

    const byAttribute = new Map<string, { nameAr: string; values: FacetBucket[] }>();
    for (const row of valueRows) {
      const count = valueCount(row.id);
      const entry = byAttribute.get(row.attributeId) ?? { nameAr: row.attribute.nameAr, values: [] };
      entry.values.push({ id: row.id, label: row.valueAr, count });
      byAttribute.set(row.attributeId, entry);
    }

    return {
      brands: brandRows.map((b) => ({
        id: b.id,
        label: b.nameAr,
        count: brands.find((x) => x.brandId === b.id)?._count._all ?? 0,
      })),
      vendors: vendorRows.map((v) => ({
        id: v.id,
        label: v.nameAr,
        count: vendors.find((x) => x.vendorId === v.id)?._count._all ?? 0,
      })),
      attributes: [...byAttribute.entries()].map(([attributeId, entry]) => ({
        attributeId,
        nameAr: entry.nameAr,
        values: entry.values.sort((a, b) => b.count - a.count),
      })),
      priceRange,
    };
  }

  /**
   * أرخص وأغلى ما في النتيجة بعملة العرض. الأدنى والأعلى لكل عملة متجر ثم
   * يُحوَّلان: مقارنة الوحدات الخام بين عملتين تجعل 10 دنانير أرخص من 20 ريالاً.
   */
  private async priceRange(
    base: Prisma.ProductWhereInput,
    currencies: readonly string[],
    fx: DisplayFx,
  ): Promise<StorefrontFacets['priceRange']> {
    const bounds = await Promise.all(
      currencies.map(async (currency) => {
        const agg = await this.prisma.productVariant.aggregate({
          where: { archivedAt: null, isActive: true, product: { AND: [base, { vendor: { settlementCurrency: currency } }] } },
          _min: { priceMinorUnits: true },
          _max: { priceMinorUnits: true },
        });
        if (agg._min.priceMinorUnits === null || agg._max.priceMinorUnits === null) return null;
        const lo = fx.convert(agg._min.priceMinorUnits, currency);
        const hi = fx.convert(agg._max.priceMinorUnits, currency);
        return lo === null || hi === null ? null : { lo, hi };
      }),
    );
    const known = bounds.filter((b): b is { lo: bigint; hi: bigint } => b !== null);
    if (known.length === 0) return null;
    const lo = known.reduce((a, b) => (b.lo < a ? b.lo : a), known[0]!.lo);
    const hi = known.reduce((a, b) => (b.hi > a ? b.hi : a), known[0]!.hi);
    return { minMinor: lo.toString(), maxMinor: hi.toString(), currency: fx.currency };
  }

  // ------------------------------------------------------------ التفاصيل

  /** صفحة المنتج — ST-07. تُقرأ بالرابط لا بالمعرّف: الرابط ما يُفهرَس. */
  async bySlug(slug: string, displayCurrency?: string) {
    const product = await this.prisma.product.findFirst({
      where: { ...VISIBLE, slug },
      include: {
        vendor: {
          select: {
            id: true,
            slug: true,
            nameAr: true,
            nameEn: true,
            status: true,
            settlementCurrency: true,
            shippingPolicyAr: true,
            returnPolicyAr: true,
            ratingAvg: true,
            ratingCount: true,
          },
        },
        vendorCategory: { select: { id: true, nameAr: true, nameEn: true } },
        brand: { select: { id: true, nameAr: true } },
        images: { orderBy: { sort: 'asc' }, select: { id: true, fileKey: true, altAr: true, variantId: true, optionValueId: true } },
        attrValues: {
          select: {
            attributeId: true,
            valueTextAr: true,
            valueNumber: true,
            valueBoolean: true,
            attribute: { select: { nameAr: true, code: true } },
            attributeValue: { select: { id: true, valueAr: true, hexColor: true } },
          },
        },
        variants: {
          where: { archivedAt: null, isActive: true },
          orderBy: { priceMinorUnits: 'asc' },
          select: {
            id: true,
            sku: true,
            priceMinorUnits: true,
            compareAtPriceMinorUnits: true,
            optionValues: {
              select: {
                attributeId: true,
                attribute: { select: { nameAr: true, code: true } },
                attributeValue: { select: { id: true, valueAr: true, hexColor: true } },
              },
            },
          },
        },
      },
    });

    if (!product) throw new NotFoundError('المنتج غير موجود أو لم يعد معروضاً.', { slug });

    const [stock, fx] = await Promise.all([
      this.inventory.levels(product.variants.map((v) => v.id)),
      this.display.resolve(displayCurrency),
    ]);
    const levels = new Map(stock.map((l) => [l.variantId, l]));
    const storeCurrency = product.vendor.settlementCurrency;
    // بلا سعر صرف نافذ تبقى الصفحة كلها بعملة المتجر
    const currency = fx.factor(storeCurrency) === null ? storeCurrency : fx.currency;

    const variants = product.variants.map((v) => {
      const shown = displayedPrice(fx, v.priceMinorUnits, storeCurrency);
      return {
        id: v.id,
        sku: v.sku,
        price: shown.price,
        /** سعر المتجر بعملته — يُعرض تحت المحوَّل حين تختلف العملتان */
        originalPrice: shown.original,
        compareAtPrice: v.compareAtPriceMinorUnits
          ? displayedPrice(fx, v.compareAtPriceMinorUnits, storeCurrency).price
          : null,
        available: levels.get(v.id)?.available ?? 0,
        options: v.optionValues.map((o) => ({
          attributeId: o.attributeId,
          nameAr: o.attribute.nameAr,
          code: o.attribute.code,
          valueId: o.attributeValue.id,
          valueAr: o.attributeValue.valueAr,
          hexColor: o.attributeValue.hexColor,
        })),
      };
    });

    const available = variants.reduce((sum, v) => sum + v.available, 0);

    return {
      id: product.id,
      slug: product.slug,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      descriptionAr: product.descriptionAr,
      descriptionEn: product.descriptionEn,
      /** عملة الأسعار المعروضة — عملة المشتري، أو عملة المتجر إن تعذّر الصرف */
      currency,
      storeCurrency,
      /** فئة المنتج في متجره — مسار التنقّل: المتجر ← فئته ← المنتج */
      storeCategory: product.vendorCategory,
      brand: product.brand,
      vendor: {
        id: product.vendor.id,
        slug: product.vendor.slug,
        nameAr: product.vendor.nameAr,
        nameEn: product.vendor.nameEn,
        shippingPolicyAr: product.vendor.shippingPolicyAr,
        returnPolicyAr: product.vendor.returnPolicyAr,
        ratingAvg: Number(product.vendor.ratingAvg),
        ratingCount: product.vendor.ratingCount,
      },
      images: product.images.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        optionValueId: i.optionValueId,
        altAr: i.altAr,
        urls: {
          thumb: `/uploads/${i.fileKey}/thumb.webp`,
          full: `/uploads/${i.fileKey}/full.webp`,
          avif: `/uploads/${i.fileKey}/full.avif`,
          medium: `/uploads/${i.fileKey}/medium.webp`,
          mediumAvif: `/uploads/${i.fileKey}/medium.avif`,
        },
      })),
      attributes: product.attrValues.map((a) => ({
        attributeId: a.attributeId,
        nameAr: a.attribute.nameAr,
        code: a.attribute.code,
        valueAr: a.attributeValue?.valueAr ?? a.valueTextAr,
        hexColor: a.attributeValue?.hexColor ?? null,
        number: a.valueNumber !== null ? a.valueNumber.toString() : null,
        boolean: a.valueBoolean,
      })),
      variants,
      available,
      isSoldOut: available <= 0,
      priceFrom: variants[0]?.price ?? priceView(0n, currency),
    };
  }

  /**
   * صفحة البائع — ST-11، والمعلَّق يردّ ST-12 لا 404. فئات المتجر أزرار تصفية
   * فوق منتجاته: الفئة التي لا منتج معروضاً فيها لا تظهر للمشتري.
   */
  async shopBySlug(
    slug: string,
    opts: { category?: string | undefined; page?: number | undefined; currency?: string | undefined } = {},
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { slug },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        status: true,
        descriptionAr: true,
        descriptionEn: true,
        shippingPolicyAr: true,
        returnPolicyAr: true,
        ratingAvg: true,
        ratingCount: true,
        createdAt: true,
      },
    });
    if (!vendor || vendor.status === 'banned') {
      throw new NotFoundError('المتجر غير موجود.', { slug });
    }

    // المعلَّق يُعرَض بحالته وبلا منتجات: إخفاؤه كلياً يكسر روابط محفوظة ومفهرسة
    const suspended = vendor.status !== 'approved';
    const [products, categories] = suspended
      ? [{ items: [], page: 1, pageSize: 24, total: 0, engine: 'db' as const, tookMs: 0 }, []]
      : await Promise.all([
          this.list({
            vendorId: vendor.id,
            ...(opts.category ? { storeCategoryId: opts.category } : {}),
            displayCurrency: opts.currency,
            page: opts.page ?? 1,
            pageSize: 24,
          }),
          this.prisma.vendorCategory.findMany({
            where: { vendorId: vendor.id },
            orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, nameAr: true, nameEn: true, _count: { select: { products: { where: VISIBLE } } } },
          }),
        ]);

    return {
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        nameAr: vendor.nameAr,
        nameEn: vendor.nameEn,
        descriptionAr: vendor.descriptionAr,
        descriptionEn: vendor.descriptionEn,
        shippingPolicyAr: vendor.shippingPolicyAr,
        returnPolicyAr: vendor.returnPolicyAr,
        ratingAvg: Number(vendor.ratingAvg),
        ratingCount: vendor.ratingCount,
        since: vendor.createdAt,
        isSuspended: suspended,
      },
      categories: categories
        .filter((c) => c._count.products > 0)
        .map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, count: c._count.products })),
      products: products.items,
      page: products.page,
      pageSize: products.pageSize,
      total: products.total,
    };
  }

  // ------------------------------------------------------------ الفهرسة

  /** يبني وثيقة الفهرس لمنتج — المصدر الوحيد لشكل الوثيقة. */
  async documentsFor(productIds: readonly string[]): Promise<SearchDocument[]> {
    if (productIds.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...productIds] }, ...VISIBLE },
      include: {
        vendor: { select: { id: true, slug: true, nameAr: true, settlementCurrency: true } },
        brand: { select: { id: true, nameAr: true } },
        vendorCategory: { select: { id: true, nameAr: true } },
        attrValues: { select: { attributeValueId: true, attributeValue: { select: { valueAr: true } } } },
        variants: {
          where: { archivedAt: null, isActive: true },
          select: {
            id: true,
            priceMinorUnits: true,
            optionValues: { select: { attributeValueId: true, attributeValue: { select: { valueAr: true } } } },
          },
          orderBy: { priceMinorUnits: 'asc' },
        },
      },
    });

    const [stock, fx] = await Promise.all([
      this.inventory.levels(rows.flatMap((r) => r.variants.map((v) => v.id))),
      this.display.resolve(),
    ]);
    const levels = new Map(stock.map((l) => [l.variantId, l]));

    return rows.map((r) => {
      const cheapest = r.variants[0]?.priceMinorUnits ?? 0n;
      const axisValues = r.variants.flatMap((v) => v.optionValues);
      const usd = fx.usd(cheapest, r.vendor.settlementCurrency);
      return {
        id: r.id,
        slug: r.slug,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        descriptionAr: r.descriptionAr,
        brandNameAr: r.brand?.nameAr ?? null,
        brandId: r.brandId,
        vendorId: r.vendor.id,
        vendorNameAr: r.vendor.nameAr,
        vendorSlug: r.vendor.slug,
        storeCategoryId: r.vendorCategory?.id ?? null,
        storeCategoryNameAr: r.vendorCategory?.nameAr ?? null,
        // اللون والمقاس محوران في المتغيّرات: بدونهما لا وجه «اللون» لقميص بألوان (DISC-028، 31 أكتوبر 2026)
        attributeValueIds: [
          ...new Set([
            ...r.attrValues.flatMap((a) => (a.attributeValueId ? [a.attributeValueId] : [])),
            ...axisValues.map((o) => o.attributeValueId),
          ]),
        ],
        attributeValuesAr: [
          ...new Set([
            ...r.attrValues.flatMap((a) => (a.attributeValue ? [a.attributeValue.valueAr] : [])),
            ...axisValues.map((o) => o.attributeValue.valueAr),
          ]),
        ],
        variantValueIds: [...new Set(axisValues.map((o) => o.attributeValueId))],
        priceMinor: Number(cheapest),
        currency: r.vendor.settlementCurrency,
        ...(usd !== null ? { priceUsd: usd } : {}),
        available: r.variants.reduce((sum, v) => sum + (levels.get(v.id)?.available ?? 0), 0),
        createdAt: Math.floor(r.createdAt.getTime() / 1000),
        publishedAt: Math.floor((r.publishedAt ?? r.createdAt).getTime() / 1000),
      };
    });
  }

  /**
   * تُستدعى بعد كل تغيير يمسّ ظهور المنتج. المنتج الذي لم يعد مرئياً يُحذف
   * من الفهرس: بقاؤه يعني ظهور منتج بائع معلَّق في نتيجة بحث.
   */
  async syncIndex(productIds: readonly string[]): Promise<void> {
    if (productIds.length === 0) return;
    const docs = await this.documentsFor(productIds);
    const visible = new Set(docs.map((d) => d.id));
    const gone = productIds.filter((id) => !visible.has(id));
    await Promise.all([
      docs.length > 0 ? this.search.upsert(docs) : Promise.resolve(true),
      gone.length > 0 ? this.search.remove(gone) : Promise.resolve(true),
    ]);
  }

  /** منتجات متغيّرات تغيّر مخزونها — المرئي منها فقط، فلا تُحذف وثيقة لم تكن في الفهرس أصلاً */
  async syncVariants(variantIds: readonly string[]): Promise<void> {
    const ids = (
      await this.prisma.product.findMany({ where: { ...VISIBLE, variants: { some: { id: { in: [...variantIds] } } } }, select: { id: true } })
    ).map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) await this.syncIndex(ids.slice(i, i + 500));
  }

  /** منتجات متجر كلها — بعد تغيّر حالته. syncIndex يضيف المرئي ويحذف ما سواه */
  async syncVendor(vendorId: string): Promise<void> {
    const ids = (await this.prisma.product.findMany({ where: { vendorId, deletedAt: null }, select: { id: true } })).map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) await this.syncIndex(ids.slice(i, i + 500));
  }

  /**
   * منتجات المتاجر بعملة تغيّر سعر صرفها — دولار الفهرس (priceUsd) يُحسب بالسعر
   * النافذ، فترتيب البحث بالسعر يتبع السعر الجديد.
   */
  async syncCurrency(currency: string): Promise<void> {
    const ids = (
      await this.prisma.product.findMany({ where: { ...VISIBLE, vendor: { status: 'approved', settlementCurrency: currency } }, select: { id: true } })
    ).map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) await this.syncIndex(ids.slice(i, i + 500));
  }

  /** إعادة بناء الفهرس كاملاً — سكربت أو لوحة إدارة. */
  async reindexAll(): Promise<{ indexed: number }> {
    const ids = await this.prisma.product.findMany({ where: VISIBLE, select: { id: true } });
    const docs = await this.documentsFor(ids.map((i) => i.id));
    this.logger.log(`إعادة فهرسة ${docs.length} منتجاً`);
    return this.search.reindex(docs);
  }
}
