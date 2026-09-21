import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InventoryService } from '../../inventory/public';
import { SearchService, type SearchDocument, type SearchInput } from '../../search/public';
import { priceView, type Page, type PriceView } from './views';

export interface StorefrontProductCard {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly price: PriceView;
  readonly compareAtPrice: PriceView | null;
  readonly vendor: { readonly id: string; readonly slug: string; readonly nameAr: string };
  readonly thumbnail: string | null;
  readonly available: number;
  readonly isSoldOut: boolean;
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
  readonly priceRange: { readonly minMinor: string; readonly maxMinor: string } | null;
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
  vendor: { select: { id: true, slug: true, nameAr: true, settlementCurrency: true } },
  variants: {
    where: { archivedAt: null, isActive: true },
    select: { id: true, priceMinorUnits: true, compareAtPriceMinorUnits: true },
    orderBy: { priceMinorUnits: 'asc' as const },
  },
  images: { take: 1, orderBy: { sort: 'asc' as const }, select: { fileKey: true } },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof CARD_INCLUDE }>;

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger('Storefront');

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly search: SearchService,
  ) {}

  // ------------------------------------------------------------- القائمة

  async list(input: SearchInput): Promise<StorefrontListResult> {
    const started = Date.now();
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(48, Math.max(1, input.pageSize ?? 24));

    const hit = input.q?.trim() ? await this.search.search({ ...input, page, pageSize }) : null;

    if (hit) {
      // الفهرس قال من المرشّحون؛ التفاصيل والأسعار من القاعدة دائماً
      const rows = await this.prisma.product.findMany({
        where: { ...VISIBLE, id: { in: [...hit.ids] } },
        include: CARD_INCLUDE,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = hit.ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
      return {
        items: await this.cards(ordered),
        page,
        pageSize,
        total: hit.total,
        engine: 'meili',
        tookMs: Date.now() - started,
        // الأوجه من توزيع المحرّك: عدّ القاعدة يتجاهل الكلمة المبحوث عنها
        facets: await this.facetsFromDistribution(hit.facets),
      };
    }

    const where = await this.whereOf(input);
    const [rows, total] = await Promise.all([
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
      items: await this.cards(rows),
      page,
      pageSize,
      total,
      engine: 'db',
      tookMs: Date.now() - started,
      facets: await this.facets(input),
    };
  }

  private orderOf(sort: SearchInput['sort']): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'newest':
        return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
      // السعر على المتغيّر لا على المنتج، فترتيبه في القاعدة يحتاج ضمّاً —
      // يُترك للمحرّك، والقاعدة ترتّب بالأحدث كي لا تكذب على المستخدم بترتيب عشوائي
      default:
        return [{ publishedAt: 'desc' }];
    }
  }

  private async whereOf(input: SearchInput): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [VISIBLE];

    if (input.categoryPath) {
      const ids = await this.categoryIdsUnder(input.categoryPath);
      and.push({ categoryId: { in: ids } });
    }
    if (input.vendorId) and.push({ vendorId: input.vendorId });
    if (input.brandId) and.push({ brandId: input.brandId });

    const term = input.q?.trim();
    if (term) {
      // السقوط من المحرّك: تطابق نصّي بسيط — أضعف تسامحاً، وأفضل من لا نتيجة
      and.push({
        OR: [
          { nameAr: { contains: term, mode: 'insensitive' } },
          { nameEn: { contains: term, mode: 'insensitive' } },
          { descriptionAr: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    for (const valueId of input.attributeValueIds ?? []) {
      and.push({ attrValues: { some: { attributeValueId: valueId } } });
    }

    const priceFilter: Prisma.ProductVariantWhereInput = {
      archivedAt: null,
      isActive: true,
      ...(input.minPriceMinor !== undefined ? { priceMinorUnits: { gte: BigInt(input.minPriceMinor) } } : {}),
      ...(input.maxPriceMinor !== undefined
        ? { priceMinorUnits: { lte: BigInt(input.maxPriceMinor) } }
        : {}),
    };
    if (input.minPriceMinor !== undefined || input.maxPriceMinor !== undefined) {
      and.push({ variants: { some: priceFilter } });
    }

    return { AND: and };
  }

  /**
   * رابط الفئة إلى مسارها الداخلي. المسار المادّي تفصيل تخزين ("/3/17/")،
   * والرابط العام يحمل اسماً مقروءاً — فالترجمة هنا لا في المتصفّح.
   * فئة غير موجودة أو موقوفة تُرجع `null` فتصير النتيجة فارغة لا خطأ.
   */
  async categoryPathOf(slug: string): Promise<string | null> {
    const row = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      select: { path: true },
    });
    return row?.path ?? null;
  }

  private async categoryIdsUnder(path: string): Promise<string[]> {
    const rows = await this.prisma.category.findMany({
      where: { path: { startsWith: path }, isActive: true },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async cards(rows: readonly CardRow[]): Promise<StorefrontProductCard[]> {
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
      // سعر المنتج يُفسَّر بعملة تسوية بائعه — ADR-013
      const currency = r.vendor.settlementCurrency;
      return {
        id: r.id,
        slug: r.slug,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        price: priceView(cheapest?.priceMinorUnits ?? 0n, currency),
        compareAtPrice: cheapest?.compareAtPriceMinorUnits
          ? priceView(cheapest.compareAtPriceMinorUnits, currency)
          : null,
        vendor: { id: r.vendor.id, slug: r.vendor.slug, nameAr: r.vendor.nameAr },
        thumbnail: r.images[0] ? `/uploads/${r.images[0].fileKey}/thumb.webp` : null,
        available,
        isSoldOut: available <= 0,
      };
    });
  }

  // -------------------------------------------------------------- الأوجه

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
  private async facets(input: SearchInput): Promise<StorefrontFacets> {
    const base = await this.whereOf({ ...input, attributeValueIds: [], q: undefined });

    const [brands, vendors, attrValues, priceAgg] = await Promise.all([
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
      this.prisma.productVariant.aggregate({
        where: { archivedAt: null, isActive: true, product: base },
        _min: { priceMinorUnits: true },
        _max: { priceMinorUnits: true },
      }),
    ]);

    const [brandRows, vendorRows, valueRows] = await Promise.all([
      this.prisma.brand.findMany({
        where: { id: { in: brands.flatMap((b) => (b.brandId ? [b.brandId] : [])) } },
        select: { id: true, nameAr: true },
      }),
      this.prisma.vendor.findMany({
        where: { id: { in: vendors.map((v) => v.vendorId) } },
        select: { id: true, nameAr: true },
      }),
      this.prisma.attributeValue.findMany({
        where: { id: { in: attrValues.flatMap((a) => (a.attributeValueId ? [a.attributeValueId] : [])) } },
        select: { id: true, valueAr: true, attributeId: true, attribute: { select: { nameAr: true } } },
      }),
    ]);

    const byAttribute = new Map<string, { nameAr: string; values: FacetBucket[] }>();
    for (const row of valueRows) {
      const count = attrValues.find((a) => a.attributeValueId === row.id)?._count._all ?? 0;
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
      priceRange:
        priceAgg._min.priceMinorUnits !== null && priceAgg._max.priceMinorUnits !== null
          ? {
              minMinor: priceAgg._min.priceMinorUnits.toString(),
              maxMinor: priceAgg._max.priceMinorUnits.toString(),
            }
          : null,
    };
  }

  // ------------------------------------------------------------ التفاصيل

  /** صفحة المنتج — ST-07. تُقرأ بالرابط لا بالمعرّف: الرابط ما يُفهرَس. */
  async bySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { ...VISIBLE, slug },
      include: {
        vendor: {
          select: {
            id: true,
            slug: true,
            nameAr: true,
            status: true,
            settlementCurrency: true,
            shippingPolicyAr: true,
            returnPolicyAr: true,
            ratingAvg: true,
            ratingCount: true,
          },
        },
        category: { select: { id: true, slug: true, nameAr: true, path: true } },
        brand: { select: { id: true, nameAr: true } },
        images: { orderBy: { sort: 'asc' }, select: { id: true, fileKey: true, altAr: true, variantId: true } },
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

    const levels = new Map(
      (await this.inventory.levels(product.variants.map((v) => v.id))).map((l) => [l.variantId, l]),
    );
    const currency = product.vendor.settlementCurrency;

    const variants = product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      price: priceView(v.priceMinorUnits, currency),
      compareAtPrice: v.compareAtPriceMinorUnits ? priceView(v.compareAtPriceMinorUnits, currency) : null,
      available: levels.get(v.id)?.available ?? 0,
      options: v.optionValues.map((o) => ({
        attributeId: o.attributeId,
        nameAr: o.attribute.nameAr,
        code: o.attribute.code,
        valueId: o.attributeValue.id,
        valueAr: o.attributeValue.valueAr,
        hexColor: o.attributeValue.hexColor,
      })),
    }));

    const available = variants.reduce((sum, v) => sum + v.available, 0);

    return {
      id: product.id,
      slug: product.slug,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      descriptionAr: product.descriptionAr,
      currency,
      category: product.category,
      brand: product.brand,
      vendor: {
        id: product.vendor.id,
        slug: product.vendor.slug,
        nameAr: product.vendor.nameAr,
        shippingPolicyAr: product.vendor.shippingPolicyAr,
        returnPolicyAr: product.vendor.returnPolicyAr,
        ratingAvg: Number(product.vendor.ratingAvg),
        ratingCount: product.vendor.ratingCount,
      },
      images: product.images.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        altAr: i.altAr,
        urls: {
          thumb: `/uploads/${i.fileKey}/thumb.webp`,
          full: `/uploads/${i.fileKey}/full.webp`,
          avif: `/uploads/${i.fileKey}/full.avif`,
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

  /** صفحة البائع — ST-11، والمعلَّق يردّ ST-12 لا 404. */
  async shopBySlug(slug: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { slug },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        status: true,
        descriptionAr: true,
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
    const products = suspended
      ? { items: [], page: 1, pageSize: 24, total: 0, engine: 'db' as const, tookMs: 0 }
      : await this.list({ vendorId: vendor.id, pageSize: 24 });

    return {
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        nameAr: vendor.nameAr,
        nameEn: vendor.nameEn,
        descriptionAr: vendor.descriptionAr,
        shippingPolicyAr: vendor.shippingPolicyAr,
        returnPolicyAr: vendor.returnPolicyAr,
        ratingAvg: Number(vendor.ratingAvg),
        ratingCount: vendor.ratingCount,
        since: vendor.createdAt,
        isSuspended: suspended,
      },
      products: products.items,
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
        category: { select: { id: true, nameAr: true, path: true } },
        attrValues: { select: { attributeValueId: true, attributeValue: { select: { valueAr: true } } } },
        variants: {
          where: { archivedAt: null, isActive: true },
          select: { id: true, priceMinorUnits: true },
          orderBy: { priceMinorUnits: 'asc' },
        },
      },
    });

    const levels = new Map(
      (await this.inventory.levels(rows.flatMap((r) => r.variants.map((v) => v.id)))).map((l) => [
        l.variantId,
        l,
      ]),
    );

    return rows.map((r) => {
      const segments = r.category.path.split('/').filter(Boolean);
      const ancestors = segments.map((_, i) => `/${segments.slice(0, i + 1).join('/')}/`);
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
        categoryId: r.category.id,
        categoryAncestors: ancestors,
        categoryNameAr: r.category.nameAr,
        attributeValueIds: r.attrValues.flatMap((a) => (a.attributeValueId ? [a.attributeValueId] : [])),
        attributeValuesAr: r.attrValues.flatMap((a) =>
          a.attributeValue ? [a.attributeValue.valueAr] : [],
        ),
        priceMinor: Number(r.variants[0]?.priceMinorUnits ?? 0n),
        currency: r.vendor.settlementCurrency,
        available: r.variants.reduce((sum, v) => sum + (levels.get(v.id)?.available ?? 0), 0),
        createdAt: Math.floor((r.publishedAt ?? r.createdAt).getTime() / 1000),
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

  /** إعادة بناء الفهرس كاملاً — سكربت أو لوحة إدارة. */
  async reindexAll(): Promise<{ indexed: number }> {
    const ids = await this.prisma.product.findMany({ where: VISIBLE, select: { id: true } });
    const docs = await this.documentsFor(ids.map((i) => i.id));
    this.logger.log(`إعادة فهرسة ${docs.length} منتجاً`);
    return this.search.reindex(docs);
  }
}
