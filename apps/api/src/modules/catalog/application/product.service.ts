import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ProductStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  DomainError,
  DuplicateError,
  InvalidInputError,
  InvalidStateTransitionError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { MoneyError, parse as parseMoney } from '../../../common/money/money';
import { dirOf, folded, like, pageArgs, type SortOrder } from '../../../common/paging';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ScopedRepository } from '../../../common/prisma/scoped-repository';
import { vendorScopeOf, type Actor, type VendorScope } from '../../../common/security/actor';
import {
  InventoryService,
  type StockChange,
  type StockView,
  type Tx,
} from '../../inventory/public';
import { VendorDirectory } from '../../vendors/public';
import { StorefrontService } from './storefront.service';
import { productSlug } from '../domain/slug';
import { assertVariantMatrix, normalizeSku, type OptionChoice } from '../domain/variant-matrix';
import { LocalImageStorage } from '../infrastructure/product-images';
import { AttributeService, isUniqueViolation, type AttributeView } from './attribute.service';
import { VendorCategoryService } from './vendor-category.service';
import {
  priceView,
  type AdminProductListItemView,
  type Page,
  type ProductDetailView,
  type ProductListItemView,
  type StockSummaryView,
} from './views';

export interface VariantInput {
  /** موجود = تعديل متغيّر قائم، غائب = متغيّر جديد */
  readonly id?: string | undefined;
  readonly sku: string;
  /** نصّ بعملة تسوية البائع: «12.500» بالدينار — يُحلَّل بـ money.parse لا بـ Number */
  readonly price: string;
  readonly compareAtPrice?: string | null | undefined;
  readonly barcode?: string | null | undefined;
  readonly weightGrams?: number | null | undefined;
  readonly options?: readonly OptionChoice[] | undefined;
  /** إلزامي للمتغيّر الجديد. في التعديل: جرد فعلي (setTo) أو غائب لا يمسّ المخزون */
  readonly stock?: number | undefined;
  readonly lowStockThreshold?: number | null | undefined;
}

export interface AttributeInput {
  readonly attributeId: string;
  readonly valueId?: string | undefined;
  readonly text?: string | undefined;
  readonly textEn?: string | undefined;
  readonly number?: number | undefined;
  readonly boolean?: boolean | undefined;
}

export interface ProductFieldsInput {
  /** فئة من فئات المتجر، أو null بلا فئة */
  readonly vendorCategoryId?: string | null | undefined;
  readonly brandId?: string | null | undefined;
  readonly nameAr: string;
  readonly nameEn?: string | null | undefined;
  readonly descriptionAr?: string | null | undefined;
  readonly descriptionEn?: string | null | undefined;
}

export interface CreateProductInput extends ProductFieldsInput {
  readonly attributes?: readonly AttributeInput[] | undefined;
  readonly variants: readonly VariantInput[];
}

export type UpdateProductInput = Partial<ProductFieldsInput> & {
  readonly attributes?: readonly AttributeInput[] | undefined;
  /** المجموعة الحيّة المطلوبة كاملةً: القائم الغائب عنها يُؤرشف */
  readonly variants?: readonly VariantInput[] | undefined;
};

export type VendorAdjustReason = 'manual_adjust' | 'damage' | 'return';

/** كل موانع النشر معاً — البائع يصلحها دفعة واحدة لا مانعاً مانعاً */
export class PublishBlockedError extends DomainError {
  readonly code = 'PUBLISH_BLOCKED';
  readonly httpStatus = 409;

  constructor(reasons: readonly string[]) {
    super(`لا يمكن نشر المنتج بعد: ${reasons.join('؛ ')}.`, { reasons });
  }
}

interface ResolvedVariant {
  readonly id: string | undefined;
  readonly sku: string;
  readonly priceMinorUnits: bigint;
  readonly compareAtPriceMinorUnits: bigint | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  readonly options: readonly OptionChoice[];
  readonly optionsKey: string;
  readonly stock: number | undefined;
  readonly lowStockThreshold: number | null | undefined;
}

interface ResolvedAttribute {
  readonly attributeId: string;
  readonly attributeValueId: string | null;
  readonly valueTextAr: string | null;
  readonly valueTextEn: string | null;
  readonly valueNumber: Prisma.Decimal | null;
  readonly valueBoolean: boolean | null;
}

/** حالة المنتج كما يقرؤها المدير في رسالة الرفض — كانت «draft» و«rejected» برموزها (ADM-052) */
const STATUS_LABELS: Readonly<Record<ProductStatus, string>> = Object.freeze({
  draft: 'مسوّدة',
  active: 'منشور',
  rejected: 'موقوف',
  archived: 'مؤرشف',
});

const ATTRIBUTE_SELECT = { id: true, code: true, nameAr: true, nameEn: true } as const;
const VALUE_SELECT = { id: true, valueAr: true, valueEn: true, hexColor: true } as const;

const DETAIL_INCLUDE = {
  vendorCategory: { select: { id: true, nameAr: true } },
  vendor: { select: { settlementCurrency: true } },
  variants: {
    where: { archivedAt: null },
    orderBy: [{ createdAt: 'asc' }, { sku: 'asc' }],
    include: {
      optionValues: {
        include: { attribute: { select: ATTRIBUTE_SELECT }, attributeValue: { select: VALUE_SELECT } },
      },
    },
  },
  attrValues: {
    include: { attribute: { select: ATTRIBUTE_SELECT }, attributeValue: { select: VALUE_SELECT } },
  },
  images: { orderBy: { sort: 'asc' } },
} satisfies Prisma.ProductInclude;

type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const EMPTY_STOCK: StockSummaryView = {
  onHand: 0,
  reserved: 0,
  available: 0,
  lowStockThreshold: 0,
  isLow: false,
};

/**
 * منتجات البائع — SRS V-02، بوابة المرحلة 05 البند الأول.
 *
 * كل قراءة وكتابة تمرّ بـ ScopedRepository أو بشرط vendorId صريح داخل
 * المعاملة (ADR-010). المنتج لا يُحذف: يُؤرشف هو ومتغيّراته، لأن حركات
 * مخزونها وطلباتها تاريخ لا يُمحى (المهاجرة 20260913100000).
 */
@Injectable()
export class ProductService {
  private readonly logger = new Logger('Catalog');

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly vendors: VendorDirectory,
    private readonly storefront: StorefrontService,
    private readonly attributes: AttributeService,
    private readonly categories: VendorCategoryService,
    private readonly storage: LocalImageStorage,
  ) {}

  private products(scope: VendorScope, db: Tx | PrismaService = this.prisma) {
    return new ScopedRepository<{ id: string }>(db.product as never, scope, 'المنتج');
  }

  private variantsRepo(scope: VendorScope, db: Tx | PrismaService = this.prisma) {
    return new ScopedRepository<{ id: string }>(db.productVariant as never, scope, 'المتغيّر');
  }

  // ================================================================ القراءة

  async get(scope: VendorScope, id: string): Promise<ProductDetailView> {
    const row = (await this.products(scope).findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    })) as ProductDetailRow | null;
    if (!row) throw new NotFoundError('المنتج غير موجود.', { id });

    const levels = await this.inventory.levels(row.variants.map((v) => v.id));
    return this.toDetail(row, new Map(levels.map((l) => [l.variantId, l])));
  }

  async list(
    scope: VendorScope,
    query: {
      status?: ProductStatus | undefined;
      search?: string | undefined;
      /** فئة من فئات المتجر، أو none لما بلا فئة */
      category?: string | undefined;
      page?: number | undefined;
      pageSize?: number | undefined;
      sort?: SortOrder | undefined;
    },
  ): Promise<Page<ProductListItemView>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const search = query.search?.trim();

    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { vendorCategoryId: query.category === 'none' ? null : query.category } : {}),
      ...(search
        ? {
            OR: [
              { nameArFold: folded(search) },
              { nameEn: like(search) },
              { variants: { some: { sku: like(search), archivedAt: null } } },
            ],
          }
        : {}),
    };

    const repo = this.products(scope);
    const [rows, total, vendor] = await Promise.all([
      repo.findMany({
        where,
        orderBy: [{ updatedAt: dirOf(query.sort, 'newest') }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          vendorCategory: { select: { id: true, nameAr: true } },
          variants: { where: { archivedAt: null }, select: { id: true, priceMinorUnits: true } },
          images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } },
        },
      }) as Promise<
        Prisma.ProductGetPayload<{
          include: {
            vendorCategory: { select: { id: true; nameAr: true } };
            variants: { select: { id: true; priceMinorUnits: true } };
            images: { select: { fileKey: true } };
          };
        }>[]
      >,
      repo.count(where),
      this.vendors.get(scope.vendorId),
    ]);

    const levels = new Map(
      (await this.inventory.levels(rows.flatMap((r) => r.variants.map((v) => v.id)))).map((l) => [
        l.variantId,
        l,
      ]),
    );
    const currency = vendor.settlementCurrency;

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => {
        const prices = r.variants.map((v) => v.priceMinorUnits).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const stock = r.variants.map((v) => levels.get(v.id));
        const first = prices[0];
        const last = prices[prices.length - 1];
        const image = r.images[0];
        return {
          id: r.id,
          nameAr: r.nameAr,
          nameEn: r.nameEn,
          status: r.status,
          vendorCategory: r.vendorCategory,
          variantCount: r.variants.length,
          priceFrom: first !== undefined ? priceView(first, currency) : null,
          priceTo: last !== undefined ? priceView(last, currency) : null,
          onHand: stock.reduce((n, s) => n + (s?.onHand ?? 0), 0),
          available: stock.reduce((n, s) => n + (s?.available ?? 0), 0),
          isLow: stock.some((s) => s?.isLow),
          thumbnail: image ? this.storage.urls(image.fileKey)['thumb.webp'] : null,
          updatedAt: r.updatedAt,
        };
      }),
    };
  }

  /**
   * VD-11 — المخزون متغيّراً متغيّراً، خمسين خمسين ببحث (اسم المنتج أو SKU) وتصفية. كانت
   * الصفحة تقرأ أول مئة منتج ثم تطلب كل منتج وحده لتعرف متغيّراته — ما بعد المئة لا يُرى،
   * والفتح مئة طلب. «المنخفض» بالعلامة نفسها التي يُنبَّه بها البائع (lowStockSince)،
   * و«النافد» ما لا متاح منه (الموجود لا يزيد على المحجوز). المنخفض أولاً.
   */
  async inventoryRows(scope: VendorScope, q: { search?: string; filter?: 'low' | 'out'; page: number }) {
    const t = q.search;
    const live: Prisma.ProductVariantWhereInput = { archivedAt: null, product: { deletedAt: null } };
    const low: Prisma.ProductVariantWhereInput = { inventory: { is: { lowStockSince: { not: null } } } };
    const out: Prisma.ProductVariantWhereInput = { inventory: { is: { onHand: { lte: this.prisma.inventory.fields.reserved } } } };
    const where: Prisma.ProductVariantWhereInput = {
      ...live,
      ...(t ? { OR: [{ sku: like(t) }, { product: { OR: [{ nameArFold: folded(t) }, { nameEn: like(t) }] } }] } : {}),
      ...(q.filter === 'low' ? low : q.filter === 'out' ? out : {}),
    };
    const orderBy: Prisma.ProductVariantOrderByWithRelationInput[] = [
      { inventory: { lowStockSince: { sort: 'asc', nulls: 'last' } } },
      { product: { nameAr: 'asc' } },
      { sku: 'asc' },
      { id: 'asc' },
    ];
    const repo = this.variantsRepo(scope);
    // عدّادات الرقائق للمتجر كله، لا لنتيجة البحث — كما كانت
    const [rows, total, all, lowCount, outCount, attention] = await Promise.all([
      repo.findMany({
        where,
        orderBy,
        ...pageArgs(q.page),
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, nameAr: true, images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } } } },
          optionValues: { orderBy: { attributeId: 'asc' }, select: { attributeValue: { select: { valueAr: true } } } },
        },
      }) as unknown as Promise<
        {
          id: string;
          sku: string;
          product: { id: string; nameAr: string; images: { fileKey: string }[] };
          optionValues: { attributeValue: { valueAr: string } }[];
        }[]
      >,
      repo.count(where),
      repo.count(live),
      repo.count({ ...live, ...low }),
      repo.count({ ...live, ...out }),
      repo.count({ ...live, OR: [low, out] }),
    ]);
    const levels = new Map((await this.inventory.levels(rows.map((r) => r.id))).map((l) => [l.variantId, l]));
    return {
      items: rows.map((r) => {
        const s = levels.get(r.id);
        const image = r.product.images[0];
        return {
          productId: r.product.id,
          productNameAr: r.product.nameAr,
          thumbnail: image ? this.storage.urls(image.fileKey)['thumb.webp'] : null,
          variantId: r.id,
          variant: r.optionValues.map((o) => o.attributeValue.valueAr).join(' · '),
          sku: r.sku,
          onHand: s?.onHand ?? 0,
          reserved: s?.reserved ?? 0,
          available: s?.available ?? 0,
          lowStockThreshold: s?.lowStockThreshold ?? 0,
          isLow: s?.isLow ?? false,
        };
      }),
      total,
      counts: { all, low: lowCount, out: outCount, attention },
    };
  }

  /** ما بلغ عتبة النفاد في متجر البائع — مصدر تنبيهه (SRS V-04). */
  async lowStock(scope: VendorScope) {
    const variants = (await this.variantsRepo(scope).findMany({
      where: { archivedAt: null, product: { deletedAt: null } },
      select: { id: true, sku: true, product: { select: { id: true, nameAr: true } } },
    })) as unknown as { id: string; sku: string; product: { id: string; nameAr: string } }[];

    const byId = new Map(variants.map((v) => [v.id, v]));
    const low = await this.inventory.lowStock(variants.map((v) => v.id));
    return low.flatMap((level) => {
      const v = byId.get(level.variantId);
      return v
        ? [{ ...level, sku: v.sku, productId: v.product.id, productNameAr: v.product.nameAr }]
        : [];
    });
  }

  // ================================================================ الإنشاء

  async create(scope: VendorScope, actor: Actor, input: CreateProductInput): Promise<ProductDetailView> {
    const vendor = await this.vendors.get(scope.vendorId);
    const effective = await this.attributes.all();
    assertNotArchived(effective, new Set(), input);
    await this.assertBrand(input.brandId);
    // لا يُضاف منتج بلا فئة — قرار صاحبة المشروع 18 أكتوبر 2026، والمتجر يبدأ بثماني فئات
    if (!input.vendorCategoryId) {
      throw new InvalidInputError('اختر فئة للمنتج — أو أضف فئة جديدة لمتجرك.', { field: 'vendorCategoryId' });
    }
    await this.categories.assertOwned(scope, input.vendorCategoryId);

    const variants = this.resolveVariants(input.variants, effective, vendor.settlementCurrency);
    for (const v of variants) {
      if (v.id !== undefined) {
        throw new InvalidInputError('متغيّرات المنتج الجديد لا تحمل معرّفات — المعرّف يُنشأ عند الحفظ.');
      }
      if (v.stock === undefined) {
        throw new InvalidInputError(`كمية المتغيّر «${v.sku}» مطلوبة — اكتب 0 إن لم يتوفّر مخزون.`, {
          sku: v.sku,
        });
      }
    }
    const attributes = this.resolveAttributes(input.attributes ?? [], effective);

    const productId = randomUUID();
    await this.write(async (tx) => {
      await this.assertSkusFree(tx, scope, variants.map((v) => v.sku), []);
      await tx.product.create({
        data: {
          id: productId,
          vendorId: scope.vendorId,
          vendorCategoryId: input.vendorCategoryId ?? null,
          brandId: input.brandId ?? null,
          slug: productSlug(input.nameEn, randomBytes(4).toString('hex')),
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          descriptionAr: input.descriptionAr ?? null,
          descriptionEn: input.descriptionEn ?? null,
          hasVariants: hasVariants(variants),
        },
      });
      const created = await this.insertVariants(tx, scope, productId, variants);
      if (attributes.length > 0) {
        await tx.productAttributeValue.createMany({
          data: attributes.map((a) => ({ productId, ...a })),
        });
      }
      await this.inventory.initialize(
        tx,
        created.map(({ id, variant }) => ({
          variantId: id,
          onHand: variant.stock ?? 0,
          lowStockThreshold: variant.lowStockThreshold,
        })),
        { reason: 'manual_adjust', actorUserId: actor.userId, refType: 'product', refId: productId, note: 'مخزون ابتدائي' },
      );
    });

    return this.get(scope, productId);
  }

  // ================================================================ التعديل

  async update(
    scope: VendorScope,
    actor: Actor,
    id: string,
    input: UpdateProductInput,
  ): Promise<ProductDetailView> {
    const current = (await this.products(scope).findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    })) as ProductDetailRow | null;
    if (!current) throw new NotFoundError('المنتج غير موجود.', { id });

    const currency = current.vendor.settlementCurrency;
    const effective = await this.attributes.all();
    assertNotArchived(
      effective,
      new Set([...current.attrValues.map((v) => v.attributeId), ...current.variants.flatMap((v) => v.optionValues.map((o) => o.attributeId))]),
      input,
    );
    if (input.brandId !== undefined) await this.assertBrand(input.brandId);
    // الفئة بعد الحفظ إلزامية: منتج قديم بلا فئة يبقى ظاهراً، ويُصنَّف عند أوّل تعديل
    const category = input.vendorCategoryId !== undefined ? input.vendorCategoryId : current.vendorCategoryId;
    if (!category) {
      throw new InvalidInputError('اختر فئة للمنتج قبل الحفظ — لا يبقى منتج بلا فئة.', { field: 'vendorCategoryId' });
    }
    if (input.vendorCategoryId) await this.categories.assertOwned(scope, input.vendorCategoryId);

    // ---- المتغيّرات: المجموعة الحيّة النهائية تُفحص كاملةً
    const liveIds = new Set(current.variants.map((v) => v.id));
    let variantPlan: { archive: string[]; update: ResolvedVariant[]; create: ResolvedVariant[] } | null =
      null;
    let finalVariants: readonly ResolvedVariant[];

    if (input.variants) {
      const seen = new Set<string>();
      for (const v of input.variants) {
        if (v.id === undefined) continue;
        if (!liveIds.has(v.id)) {
          throw new NotFoundError('المتغيّر غير موجود في هذا المنتج.', { variantId: v.id });
        }
        if (seen.has(v.id)) throw new InvalidInputError('المتغيّر نفسه مذكور مرتين.', { variantId: v.id });
        seen.add(v.id);
      }
      const sent = input.variants;
      const resolved = this.resolveVariants(sent, effective, currency).map((v, i) => {
        /**
         * ما لم يُرسَل لمتغيّر قائم يبقى كما هو، و null يمحوه صراحةً. المحرّر لا خانات له
         * للسعر قبل الخصم والباركود والوزن — تدخل بالاستيراد — فكان كل حفظ لاسم أو وصف
         * يكتبها فارغة: يختفي الخصم عن المشتري، والوزن من تسعير الشحن by_weight (VCAT-017).
         */
        const was = v.id === undefined ? undefined : current.variants.find((c) => c.id === v.id);
        if (!was) return v;
        const given = sent[i];
        return {
          ...v,
          compareAtPriceMinorUnits: given?.compareAtPrice === undefined ? was.compareAtPriceMinorUnits : v.compareAtPriceMinorUnits,
          barcode: given?.barcode === undefined ? was.barcode : v.barcode,
          weightGrams: given?.weightGrams === undefined ? was.weightGrams : v.weightGrams,
        };
      });
      for (const v of resolved) {
        if (v.id === undefined && v.stock === undefined) {
          throw new InvalidInputError(`كمية المتغيّر الجديد «${v.sku}» مطلوبة — اكتب 0 إن لم يتوفّر.`, {
            sku: v.sku,
          });
        }
      }
      variantPlan = {
        archive: current.variants.filter((v) => !seen.has(v.id)).map((v) => v.id),
        update: resolved.filter((v) => v.id !== undefined),
        create: resolved.filter((v) => v.id === undefined),
      };
      finalVariants = resolved;
    } else {
      finalVariants = current.variants.map((v) => this.asResolved(v, currency));
    }

    // ---- السمات: المُرسلة تستبدل القائمة
    const attributes = input.attributes ? this.resolveAttributes(input.attributes, effective) : null;

    // لا مراجعة (15 أكتوبر 2026، ألغى Q-16): تعديل المنشور يظهر للمشترين فور الحفظ،
    // ولا يغيّر حالته — الإدارة توقف المخالف بعد النشر لا قبله

    await this.write(async (tx) => {
      const fields: Prisma.ProductUncheckedUpdateManyInput = {};
      if (input.vendorCategoryId !== undefined) fields.vendorCategoryId = input.vendorCategoryId;
      if (input.brandId !== undefined) fields.brandId = input.brandId;
      if (input.nameAr !== undefined) fields.nameAr = input.nameAr;
      if (input.nameEn !== undefined) fields.nameEn = input.nameEn;
      if (input.descriptionAr !== undefined) fields.descriptionAr = input.descriptionAr;
      if (input.descriptionEn !== undefined) fields.descriptionEn = input.descriptionEn;
      if (variantPlan) fields.hasVariants = hasVariants(finalVariants);
      // updatedAt يتحرّك مع كل تعديل ولو مسّ المتغيّرات وحدها — قائمة البائع مرتّبة به
      fields.updatedAt = new Date();
      await this.products(scope, tx).updateOwned(id, fields);

      if (variantPlan) {
        const now = new Date();
        const variants = this.variantsRepo(scope, tx);
        // الأرشفة أولاً: تحرّر SKU والتركيبة قبل أن يطلبها متغيّر جديد
        if (variantPlan.archive.length > 0) {
          await variants.updateWhere(
            { id: { in: variantPlan.archive }, productId: id },
            { archivedAt: now, isActive: false },
          );
        }
        await this.assertSkusFree(
          tx,
          scope,
          finalVariants.map((v) => v.sku),
          [...liveIds],
        );

        for (const v of variantPlan.update) {
          const variantId = v.id as string;
          await variants.updateOwned(variantId, {
            sku: v.sku,
            optionsKey: v.optionsKey,
            priceMinorUnits: v.priceMinorUnits,
            compareAtPriceMinorUnits: v.compareAtPriceMinorUnits,
            barcode: v.barcode,
            weightGrams: v.weightGrams,
          });
          await tx.variantOptionValue.deleteMany({ where: { variantId } });
          if (v.options.length > 0) {
            await tx.variantOptionValue.createMany({
              data: v.options.map((o) => ({ variantId, attributeId: o.attributeId, attributeValueId: o.valueId })),
            });
          }
        }

        const created = await this.insertVariants(tx, scope, id, variantPlan.create);
        await this.inventory.initialize(
          tx,
          created.map(({ id: variantId, variant }) => ({
            variantId,
            onHand: variant.stock ?? 0,
            lowStockThreshold: variant.lowStockThreshold,
          })),
          { reason: 'manual_adjust', actorUserId: actor.userId, refType: 'product', refId: id, note: 'مخزون ابتدائي' },
        );

        // بترتيب المعرّف كالحجز تماماً — ترتيبان مختلفان لقفل الصفوف نفسها يتعطّلان تبادلياً
        const adjustments = variantPlan.update
          .filter((v) => v.stock !== undefined || v.lowStockThreshold !== undefined)
          .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
        for (const v of adjustments) {
          await this.inventory.adjust(
            {
              variantId: v.id as string,
              change: v.stock !== undefined ? { setTo: v.stock } : { delta: 0 },
              lowStockThreshold: v.lowStockThreshold,
            },
            { reason: 'manual_adjust', actorUserId: actor.userId, refType: 'product', refId: id },
            tx,
          );
        }
      }

      if (attributes) {
        await tx.productAttributeValue.deleteMany({ where: { productId: id } });
        if (attributes.length > 0) {
          await tx.productAttributeValue.createMany({ data: attributes.map((a) => ({ productId: id, ...a })) });
        }
      }
    });

    // المنشور يبقى منشوراً بتغيير سعره أو فئة متجره — ووثيقة البحث تحملهما
    this.reindex(id);
    return this.get(scope, id);
  }

  /** تعديل مخزون متغيّر واحد: جرد (setTo) أو حدث (delta) بسببه. */
  async adjustStock(
    scope: VendorScope,
    actor: Actor,
    productId: string,
    variantId: string,
    input: {
      change: StockChange;
      reason: VendorAdjustReason;
      note?: string | null | undefined;
      lowStockThreshold?: number | null | undefined;
    },
  ): Promise<StockView> {
    const variant = await this.variantsRepo(scope).findFirst({
      where: { id: variantId, productId, archivedAt: null },
      select: { id: true },
    });
    if (!variant) throw new NotFoundError('المتغيّر غير موجود.', { variantId });

    return this.inventory.adjust(
      { variantId, change: input.change, lowStockThreshold: input.lowStockThreshold },
      { reason: input.reason, actorUserId: actor.userId, refType: 'product', refId: productId, note: input.note },
    );
  }

  // ================================================================ الحذف والنشر

  /**
   * «حذف» المنتج أرشفة: يختفي من المتجر ومن قائمة البائع ويتحرّر SKU.
   * المخزون الفعلي لا يُصفَّر — القطع موجودة في مستودع البائع — والحجوزات
   * القائمة تبقى صالحة حتى تكتمل أو تنتهي (القرار 13 بروحه: لا يُفسد الإيقاف ما بدأ).
   */
  async remove(scope: VendorScope, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const products = this.products(scope, tx);
      const found = await products.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!found) throw new NotFoundError('المنتج غير موجود.', { id });

      const now = new Date();
      await products.updateOwned(id, { deletedAt: now, status: 'archived' });
      await this.variantsRepo(scope, tx).updateWhere(
        { productId: id, archivedAt: null },
        { archivedAt: now, isActive: false },
      );
    });
    this.reindex(id);
    await this.dropUnorderedImages(id);
  }

  /**
   * صور المنتج المحذوف لا تبقى على القرص إلا ما صار لقطة في طلب — سجلّ طلبات
   * المشتري يعرضها. البوابة تحجبها عن العموم أصلاً؛ وهذا لئلا يبقى ملف لا يُطلب.
   * فشل حذف ملف يُسجَّل ولا يُعيد الحذف: المنتج محذوف والملف محجوب.
   */
  private async dropUnorderedImages(productId: string): Promise<void> {
    const images = await this.prisma.productImage.findMany({ where: { productId }, select: { id: true, fileKey: true } });
    if (images.length === 0) return;
    const ordered = new Set(
      (
        await this.prisma.orderItem.findMany({
          where: { imageKeySnapshot: { in: images.map((i) => i.fileKey) } },
          select: { imageKeySnapshot: true },
          distinct: ['imageKeySnapshot'],
        })
      ).map((o) => o.imageKeySnapshot),
    );
    const orphan = images.filter((i) => !ordered.has(i.fileKey));
    await this.prisma.productImage.deleteMany({ where: { id: { in: orphan.map((i) => i.id) } } });
    for (const img of orphan) {
      await this.storage.remove(img.fileKey).catch((err: unknown) => this.logger.error(`تعذّر حذف ملفات الصورة ${img.fileKey}`, err as Error));
    }
  }

  async publish(scope: VendorScope, id: string): Promise<ProductDetailView> {
    const product = (await this.products(scope).findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    })) as ProductDetailRow | null;
    if (!product) throw new NotFoundError('المنتج غير موجود.', { id });

    const vendor = await this.vendors.get(scope.vendorId);

    const reasons: string[] = [];
    // قيد المراجعة ينشر فيُحفظ منشوراً، ويظهر للمشترين فور اعتماد متجره (قاعدة الرؤية
    // تشترط بائعاً معتمداً). المعلَّق لا ينشر جديداً: منتجاته مخفية حتى يُرفع التعليق
    if (vendor.status === 'suspended' || vendor.status === 'banned') {
      reasons.push('المتجر معلَّق — لا تنشر منتجاً حتى يُرفع التعليق');
    } else if (vendor.status !== 'approved' && vendor.status !== 'in_review') {
      reasons.push('أرسل طلب متجرك للمراجعة أولاً — النشر يُتاح من لحظة إرساله');
    }
    if (!product.variants.some((v) => v.isActive)) reasons.push('لا متغيّر فعّال يحمل سعراً');
    if (!product.vendorCategoryId) reasons.push('اختر فئة للمنتج من «الفئة في متجرك»');
    // المشتري يشتري ما يراه — منتج بلا صورة لا يُنشر
    if (product.images.length === 0) reasons.push('أضف صورة واحدة على الأقل — الأولى هي الرئيسية في المتجر');

    if (reasons.length > 0) throw new PublishBlockedError(reasons);

    /**
     * لا مراجعة قبل النشر — قرار صاحب المشروع 15 أكتوبر 2026، ألغى Q-15:
     * «المنتجات تنزل على حساب الزبون من دون مراجعة الإدارة». النشر فوري، والمنشور
     * أول مرة يأخذ publishedAt ويحتفظ به إن أُوقف ثم أُعيد. النشر المكرر لا يغيّر شيئاً.
     */
    if (product.status !== 'active') {
      await this.products(scope).updateOwned(id, {
        status: 'active',
        rejectReason: null,
        publishedAt: product.publishedAt ?? new Date(),
      });
    }
    this.reindex(id);
    return this.get(scope, id);
  }

  /** إيقاف النشر بيد البائع: يعود مسودة من أي حالة. */
  async unpublish(scope: VendorScope, id: string): Promise<ProductDetailView> {
    const found = await this.products(scope).findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundError('المنتج غير موجود.', { id });
    await this.products(scope).updateOwned(id, { status: 'draft' });
    this.reindex(id);
    return this.get(scope, id);
  }

  // ================================================================ الإدارة
  // وصول إداري صريح بلا نطاق بائع: الإدارة ترى كل المتاجر (ADR-010).

  /**
   * إيقاف منشور مخالف بسبب يراه البائع — بعد النشر لا قبله (لا مراجعة منذ 15 أكتوبر
   * 2026). يختفي من المتجر فوراً، والبائع يعدّله وينشره من جديد. المسودة لم تُنشر فلا تُوقف.
   */
  /**
   * يعيد السبب كما حُفظ — يُقاس بعد إزالة المسافات من طرفيه: خمس مسافات كانت تمرّ بحدّ
   * الطول فيصل البائع سبب فارغ (ADM-051، 30 أكتوبر 2026).
   */
  async reject(id: string, reason: string): Promise<string> {
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 500) {
      throw new InvalidInputError('سبب الإيقاف من 5 أحرف إلى 500 — البائع يصلح بناءً عليه.');
    }
    const { count } = await this.prisma.product.updateMany({
      where: { id, deletedAt: null, status: 'active' },
      data: { status: 'rejected', rejectReason: trimmed },
    });
    if (count === 0) {
      const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
      if (!product) throw new NotFoundError('المنتج غير موجود.', { id });
      throw new InvalidStateTransitionError(STATUS_LABELS[product.status], STATUS_LABELS.rejected);
    }
    this.reindex(id);
    return trimmed;
  }

  /** تفاصيل المنتج كما يراها البائع، للإدارة — بنطاق بائعه صراحةً. */
  async adminGet(actor: Actor, id: string): Promise<ProductDetailView> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { vendorId: true },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود.', { id });
    return this.get(vendorScopeOf(actor, product.vendorId), id);
  }

  /** منتجات المنصة، الأحدث تعديلاً أولاً — للإدارة تتابع المنشور وتوقف المخالف. */
  async adminList(query: {
    status?: ProductStatus | undefined;
    search?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
    sort?: SortOrder | undefined;
  }): Promise<Page<AdminProductListItemView>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const search = query.search?.trim();

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { nameArFold: folded(search) },
              { nameEn: like(search) },
              { vendor: { nameArFold: folded(search) } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: dirOf(query.sort, 'newest') }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          vendor: { select: { id: true, nameAr: true, status: true, settlementCurrency: true } },
          vendorCategory: { select: { nameAr: true } },
          variants: { where: { archivedAt: null }, select: { priceMinorUnits: true } },
          images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => {
        const lowest = r.variants
          .map((v) => v.priceMinorUnits)
          .reduce<bigint | null>((min, p) => (min === null || p < min ? p : min), null);
        const image = r.images[0];
        return {
          id: r.id,
          nameAr: r.nameAr,
          nameEn: r.nameEn,
          status: r.status,
          rejectReason: r.rejectReason,
          vendor: { id: r.vendor.id, nameAr: r.vendor.nameAr, status: r.vendor.status },
          vendorCategoryNameAr: r.vendorCategory?.nameAr ?? null,
          variantCount: r.variants.length,
          priceFrom: lowest !== null ? priceView(lowest, r.vendor.settlementCurrency) : null,
          thumbnail: image ? this.storage.urls(image.fileKey)['thumb.webp'] : null,
          updatedAt: r.updatedAt,
        };
      }),
    };
  }

  // ================================================================ داخلي

  private async write(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await this.prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const target = JSON.stringify((err as Prisma.PrismaClientKnownRequestError).meta ?? {});
        throw new DuplicateError(
          target.includes('options')
            ? 'التركيبة نفسها موجودة لمتغيّر آخر في المنتج — غيّر قيمة خيار.'
            : 'SKU مستعمل لمتغيّر آخر في متجرك — لكل متغيّر حيّ SKU فريد على مستوى المتجر.',
        );
      }
      throw err;
    }
  }

  private async assertBrand(brandId: string | null | undefined): Promise<void> {
    if (!brandId) return;
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new NotFoundError('العلامة التجارية غير موجودة.', { brandId });
  }

  /** رسالة تسمّي SKU المتعارض — القيد الفريد في القاعدة يبقى الحكم عند السباق */
  private async assertSkusFree(
    tx: Tx,
    scope: VendorScope,
    skus: readonly string[],
    excludeVariantIds: readonly string[],
  ): Promise<void> {
    if (skus.length === 0) return;
    const taken = (await this.variantsRepo(scope, tx).findMany({
      where: {
        sku: { in: [...skus] },
        archivedAt: null,
        ...(excludeVariantIds.length > 0 ? { id: { notIn: [...excludeVariantIds] } } : {}),
      },
      select: { sku: true },
    })) as unknown as { sku: string }[];
    if (taken.length > 0) {
      const list = taken.map((t) => `«${t.sku}»`).join('، ');
      throw new DuplicateError(`SKU ${list} مستعمل لمتغيّر آخر في متجرك.`, {
        skus: taken.map((t) => t.sku),
      });
    }
  }

  private async insertVariants(
    tx: Tx,
    scope: VendorScope,
    productId: string,
    variants: readonly ResolvedVariant[],
  ): Promise<{ id: string; variant: ResolvedVariant }[]> {
    if (variants.length === 0) return [];
    const rows = variants.map((variant) => ({ id: randomUUID(), variant }));

    await tx.productVariant.createMany({
      data: rows.map(({ id, variant }) => ({
        id,
        productId,
        vendorId: scope.vendorId,
        sku: variant.sku,
        optionsKey: variant.optionsKey,
        priceMinorUnits: variant.priceMinorUnits,
        compareAtPriceMinorUnits: variant.compareAtPriceMinorUnits,
        barcode: variant.barcode,
        weightGrams: variant.weightGrams,
      })),
    });

    const options = rows.flatMap(({ id, variant }) =>
      variant.options.map((o) => ({ variantId: id, attributeId: o.attributeId, attributeValueId: o.valueId })),
    );
    if (options.length > 0) await tx.variantOptionValue.createMany({ data: options });
    return rows;
  }

  private parsePrice(input: string, currency: string, label: string): bigint {
    try {
      const minor = parseMoney(input, currency).minorUnits;
      if (minor <= 0n) throw new InvalidInputError(`${label} يجب أن يكون أكبر من صفر.`);
      return minor;
    } catch (err) {
      if (err instanceof MoneyError) throw new InvalidInputError(`${label}: ${err.message}`);
      throw err;
    }
  }

  private resolveVariants(
    inputs: readonly VariantInput[],
    effective: readonly AttributeView[],
    currency: string,
  ): ResolvedVariant[] {
    const keys = assertVariantMatrix(inputs.map((v) => ({ sku: v.sku, options: v.options ?? [] })));
    const axes = new Map(effective.filter((a) => a.isVariantAxis).map((a) => [a.attributeId, a]));

    return inputs.map((input, i) => {
      const sku = normalizeSku(input.sku);
      for (const option of input.options ?? []) {
        const axis = axes.get(option.attributeId);
        if (!axis) {
          throw new InvalidInputError(
            `خيار في المتغيّر «${sku}» يشير إلى سمة ليست من سمات المتغيّرات (كاللون والمقاس).`,
            { sku, attributeId: option.attributeId },
          );
        }
        if (!axis.values.some((value) => value.id === option.valueId)) {
          throw new InvalidInputError(
            `القيمة المختارة لـ«${axis.nameAr}» في المتغيّر «${sku}» ليست من قيمها المعرّفة.`,
            { sku, attributeId: option.attributeId, valueId: option.valueId },
          );
        }
      }

      const priceMinorUnits = this.parsePrice(input.price, currency, `سعر المتغيّر «${sku}»`);
      const compareAtPriceMinorUnits = input.compareAtPrice
        ? this.parsePrice(input.compareAtPrice, currency, `السعر قبل الخصم للمتغيّر «${sku}»`)
        : null;
      if (compareAtPriceMinorUnits !== null && compareAtPriceMinorUnits <= priceMinorUnits) {
        throw new InvalidInputError(
          `السعر قبل الخصم للمتغيّر «${sku}» يجب أن يكون أعلى من سعره، أو اتركه فارغاً.`,
          { sku },
        );
      }
      if (input.weightGrams != null && (!Number.isInteger(input.weightGrams) || input.weightGrams < 0)) {
        throw new InvalidInputError(`وزن المتغيّر «${sku}» عدد صحيح بالغرام لا يقل عن صفر.`, { sku });
      }

      return {
        id: input.id,
        sku,
        priceMinorUnits,
        compareAtPriceMinorUnits,
        barcode: input.barcode?.trim() || null,
        weightGrams: input.weightGrams ?? null,
        options: input.options ?? [],
        optionsKey: keys[i] ?? '',
        stock: input.stock,
        lowStockThreshold: input.lowStockThreshold,
      };
    });
  }

  private resolveAttributes(
    inputs: readonly AttributeInput[],
    effective: readonly AttributeView[],
  ): ResolvedAttribute[] {
    const byId = new Map(effective.map((a) => [a.attributeId, a]));
    const seen = new Set<string>();

    return inputs.map((input) => {
      const attribute = byId.get(input.attributeId);
      if (!attribute) {
        throw new InvalidInputError('السمة غير موجودة.', { attributeId: input.attributeId });
      }
      if (attribute.isVariantAxis) {
        throw new InvalidInputError(
          `«${attribute.nameAr}» سمة متغيّرات — تُحدَّد على كل متغيّر لا على المنتج.`,
          { attributeId: input.attributeId },
        );
      }
      if (seen.has(input.attributeId)) {
        throw new InvalidInputError(`السمة «${attribute.nameAr}» مذكورة مرتين.`);
      }
      seen.add(input.attributeId);

      const empty: ResolvedAttribute = {
        attributeId: input.attributeId,
        attributeValueId: null,
        valueTextAr: null,
        valueTextEn: null,
        valueNumber: null,
        valueBoolean: null,
      };

      switch (attribute.inputType) {
        case 'select': {
          if (!input.valueId || !attribute.values.some((v) => v.id === input.valueId)) {
            throw new InvalidInputError(`اختر قيمة من قيم «${attribute.nameAr}» المعرّفة.`);
          }
          return { ...empty, attributeValueId: input.valueId };
        }
        case 'number': {
          if (input.number === undefined || !Number.isFinite(input.number)) {
            throw new InvalidInputError(`«${attribute.nameAr}» تحتاج رقماً.`);
          }
          return { ...empty, valueNumber: new Prisma.Decimal(input.number) };
        }
        case 'text': {
          const text = input.text?.trim() ?? '';
          if (text === '' || text.length > 500) {
            throw new InvalidInputError(`«${attribute.nameAr}» نصّ من حرف إلى 500 حرف.`);
          }
          return { ...empty, valueTextAr: text, valueTextEn: input.textEn?.trim() || null };
        }
        case 'boolean': {
          if (typeof input.boolean !== 'boolean') {
            throw new InvalidInputError(`«${attribute.nameAr}» نعم أو لا.`);
          }
          return { ...empty, valueBoolean: input.boolean };
        }
        default:
          // product_attribute_values فريد على (المنتج، السمة) — لا يحمل قيماً متعددة بعد
          throw new InvalidInputError(
            `السمات متعددة الاختيار («${attribute.nameAr}») غير مدعومة على المنتج بعد.`,
          );
      }
    });
  }

  private asResolved(v: ProductDetailRow['variants'][number], currency: string): ResolvedVariant {
    void currency;
    return {
      id: v.id,
      sku: v.sku,
      priceMinorUnits: v.priceMinorUnits,
      compareAtPriceMinorUnits: v.compareAtPriceMinorUnits,
      barcode: v.barcode,
      weightGrams: v.weightGrams,
      options: v.optionValues.map((o) => ({ attributeId: o.attributeId, valueId: o.attributeValueId })),
      optionsKey: v.optionsKey,
      stock: undefined,
      lowStockThreshold: undefined,
    };
  }

  private toDetail(row: ProductDetailRow, levels: ReadonlyMap<string, StockView>): ProductDetailView {
    const currency = row.vendor.settlementCurrency;
    return {
      id: row.id,
      slug: row.slug,
      status: row.status,
      rejectReason: row.rejectReason,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      descriptionAr: row.descriptionAr,
      descriptionEn: row.descriptionEn,
      vendorCategory: row.vendorCategory,
      brandId: row.brandId,
      hasVariants: row.hasVariants,
      currency,
      attributes: row.attrValues.map((a) => ({
        attributeId: a.attributeId,
        code: a.attribute.code,
        nameAr: a.attribute.nameAr,
        nameEn: a.attribute.nameEn,
        valueId: a.attributeValueId,
        valueAr: a.attributeValue?.valueAr ?? a.valueTextAr,
        valueEn: a.attributeValue?.valueEn ?? a.valueTextEn,
        number: a.valueNumber?.toString() ?? null,
        boolean: a.valueBoolean,
      })),
      variants: row.variants.map((v) => {
        const level = levels.get(v.id);
        return {
          id: v.id,
          sku: v.sku,
          options: v.optionValues
            .map((o) => ({
              attributeId: o.attributeId,
              attributeCode: o.attribute.code,
              nameAr: o.attribute.nameAr,
              nameEn: o.attribute.nameEn,
              valueId: o.attributeValueId,
              valueAr: o.attributeValue.valueAr,
              valueEn: o.attributeValue.valueEn,
              hexColor: o.attributeValue.hexColor,
            }))
            .sort((a, b) => (a.attributeId < b.attributeId ? -1 : 1)),
          price: priceView(v.priceMinorUnits, currency),
          compareAtPrice:
            v.compareAtPriceMinorUnits !== null ? priceView(v.compareAtPriceMinorUnits, currency) : null,
          barcode: v.barcode,
          weightGrams: v.weightGrams,
          isActive: v.isActive,
          stock: level
            ? {
                onHand: level.onHand,
                reserved: level.reserved,
                available: level.available,
                lowStockThreshold: level.lowStockThreshold,
                isLow: level.isLow,
              }
            : EMPTY_STOCK,
        };
      }),
      images: row.images.map((img) => ({
        id: img.id,
        variantId: img.variantId,
        optionValueId: img.optionValueId,
        altAr: img.altAr,
        altEn: img.altEn,
        width: img.width,
        height: img.height,
        sort: img.sort,
        urls: this.storage.urls(img.fileKey),
      })),
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * مزامنة فهرس البحث بعد تغيير يمسّ ظهور المنتج.
   *
   * **لا تُنتظر ولا تُسقط العملية التجارية.** نشرٌ يفشل لأن محرّك البحث نائم
   * خسارةٌ مباشرة، ومنتجٌ نُشر ولم يُفهرس يظهر بعد أول إعادة بناء (ADR-014).
   * والفشل يُسجَّل بمستوى خطأ فلا يمرّ صامتاً.
   */
  private reindex(productId: string): void {
    void this.storefront.syncIndex([productId]).catch((err: unknown) => {
      this.logger.error(`تعذّرت مزامنة فهرس المنتج ${productId}`, err as Error);
    });
  }
}

const hasVariants = (variants: readonly { options: readonly OptionChoice[] }[]): boolean =>
  variants.length > 1 || (variants[0]?.options.length ?? 0) > 0;

/**
 * الخصيصة المؤرشفة لا تُختار لمنتج لم يستعملها، وتبقى لمنتج يستعملها من قبل — فحفظه لا
 * ينكسر بأرشفتها (ACFG-099، 1 نوفمبر 2026). `used`: خصائص المنتج قبل التعديل.
 */
function assertNotArchived(
  all: readonly AttributeView[],
  used: ReadonlySet<string>,
  input: { readonly attributes?: readonly AttributeInput[] | undefined; readonly variants?: readonly VariantInput[] | undefined },
): void {
  const sent = new Set([
    ...(input.attributes ?? []).map((a) => a.attributeId),
    ...(input.variants ?? []).flatMap((v) => (v.options ?? []).map((o) => o.attributeId)),
  ]);
  const archived = all.find((a) => a.archived && sent.has(a.attributeId) && !used.has(a.attributeId));
  if (archived) {
    throw new InvalidInputError(`«${archived.nameAr}» مؤرشفة — لا تُختار لمنتج جديد.`, { attributeId: archived.attributeId });
  }
}
