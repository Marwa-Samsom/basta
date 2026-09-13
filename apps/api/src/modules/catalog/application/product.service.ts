import { Injectable } from '@nestjs/common';
import { Prisma, type ProductStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  DomainError,
  DuplicateError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import {
  MoneyError,
  money,
  parse as parseMoney,
  toDecimalString,
} from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ScopedRepository } from '../../../common/prisma/scoped-repository';
import type { Actor, VendorScope } from '../../../common/security/actor';
import {
  InventoryService,
  type StockChange,
  type StockView,
  type Tx,
} from '../../inventory/public';
import { VendorDirectory } from '../../vendors/public';
import { productSlug } from '../domain/slug';
import {
  assertVariantMatrix,
  missingRequiredAttributes,
  normalizeSku,
  type OptionChoice,
} from '../domain/variant-matrix';
import { LocalImageStorage } from '../infrastructure/product-images';
import { CategoryService, isUniqueViolation, type EffectiveAttribute } from './category.service';
import {
  priceView,
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
  readonly categoryId: string;
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

const ATTRIBUTE_SELECT = { id: true, code: true, nameAr: true, nameEn: true } as const;
const VALUE_SELECT = { id: true, valueAr: true, valueEn: true, hexColor: true } as const;

const DETAIL_INCLUDE = {
  category: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly vendors: VendorDirectory,
    private readonly categories: CategoryService,
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
    query: { status?: ProductStatus | undefined; search?: string | undefined; page?: number | undefined; pageSize?: number | undefined },
  ): Promise<Page<ProductListItemView>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const search = query.search?.trim();

    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { nameAr: { contains: search, mode: 'insensitive' } },
              { nameEn: { contains: search, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: search, mode: 'insensitive' }, archivedAt: null } } },
            ],
          }
        : {}),
    };

    const repo = this.products(scope);
    const [rows, total, vendor] = await Promise.all([
      repo.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          variants: { where: { archivedAt: null }, select: { id: true, priceMinorUnits: true } },
          images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } },
        },
      }) as Promise<
        Prisma.ProductGetPayload<{
          include: {
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
    const effective = await this.effectiveFor(input.categoryId);
    await this.assertBrand(input.brandId);

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
          categoryId: input.categoryId,
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
    const categoryChanged = input.categoryId !== undefined && input.categoryId !== current.categoryId;
    const effective = await this.effectiveFor(input.categoryId ?? current.categoryId);
    if (input.brandId !== undefined) await this.assertBrand(input.brandId);

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
      const resolved = this.resolveVariants(input.variants, effective, currency);
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
      // الفئة الجديدة قد لا تعرّف سمات المتغيّرات القائمة — يُعاد فحصها عليها
      finalVariants = categoryChanged
        ? this.resolveVariants(current.variants.map((v) => this.asInput(v, currency)), effective, currency)
        : current.variants.map((v) => this.asResolved(v, currency));
    }

    // ---- السمات: المُرسلة تستبدل القائمة، والفئة الجديدة تُعيد فحص القائمة
    const attributes = input.attributes
      ? this.resolveAttributes(input.attributes, effective)
      : categoryChanged
        ? this.resolveAttributes(current.attrValues.map(asAttributeInput), effective)
        : null;

    if (current.status === 'active') {
      const provided = providedAttributeIds(
        attributes ?? current.attrValues.map((a) => ({ attributeId: a.attributeId })),
        finalVariants,
      );
      const missing = missingRequiredAttributes(
        effective.filter((a) => a.isRequired).map((a) => ({ attributeId: a.attributeId, nameAr: a.nameAr })),
        provided,
      );
      if (missing.length > 0) {
        throw new InvalidInputError(
          `المنتج منشور، والتعديل يترك سمات إلزامية فارغة: ${missing.join('، ')}. املأها أو أوقف النشر أولاً.`,
          { missing },
        );
      }
    }

    await this.write(async (tx) => {
      const fields: Prisma.ProductUncheckedUpdateManyInput = {};
      if (input.categoryId !== undefined) fields.categoryId = input.categoryId;
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
  }

  async publish(scope: VendorScope, id: string): Promise<ProductDetailView> {
    const product = (await this.products(scope).findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    })) as ProductDetailRow | null;
    if (!product) throw new NotFoundError('المنتج غير موجود.', { id });

    const [vendor, category, effective] = await Promise.all([
      this.vendors.get(scope.vendorId),
      this.prisma.category.findUnique({ where: { id: product.categoryId }, select: { isActive: true } }),
      this.categories.effectiveAttributes(product.categoryId),
    ]);

    const reasons: string[] = [];
    if (vendor.status !== 'approved') {
      reasons.push('المتجر لم يُعتمد بعد — النشر يُتاح بعد مراجعة الإدارة لوثائقه');
    }
    if (!category?.isActive) reasons.push('الفئة موقوفة — انقل المنتج إلى فئة فعّالة');
    if (!product.variants.some((v) => v.isActive)) reasons.push('لا متغيّر فعّال يحمل سعراً');

    const missing = missingRequiredAttributes(
      effective.filter((a) => a.isRequired).map((a) => ({ attributeId: a.attributeId, nameAr: a.nameAr })),
      providedAttributeIds(
        product.attrValues.map((a) => ({ attributeId: a.attributeId })),
        product.variants.map((v) => this.asResolved(v, vendor.settlementCurrency)),
      ),
    );
    if (missing.length > 0) reasons.push(`سمات إلزامية للفئة لم تُملأ: ${missing.join('، ')}`);

    if (reasons.length > 0) throw new PublishBlockedError(reasons);

    await this.products(scope).updateOwned(id, {
      status: 'active',
      rejectReason: null,
      publishedAt: product.publishedAt ?? new Date(),
    });
    return this.get(scope, id);
  }

  async unpublish(scope: VendorScope, id: string): Promise<ProductDetailView> {
    const found = await this.products(scope).findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundError('المنتج غير موجود.', { id });
    await this.products(scope).updateOwned(id, { status: 'draft' });
    return this.get(scope, id);
  }

  /**
   * رفض إداري لمنتج منشور — لا مراجعة مسبقة (Q-15). البائع يرى السبب ويصلح ويعيد النشر.
   * وصول إداري صريح بلا نطاق بائع: الإدارة ترى كل المتاجر (ADR-010).
   */
  async reject(id: string, reason: string): Promise<void> {
    const { count } = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: { status: 'rejected', rejectReason: reason },
    });
    if (count === 0) throw new NotFoundError('المنتج غير موجود.', { id });
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

  private async effectiveFor(categoryId: string): Promise<EffectiveAttribute[]> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { isActive: true },
    });
    if (!category) throw new NotFoundError('الفئة غير موجودة.', { categoryId });
    if (!category.isActive) throw new InvalidInputError('الفئة موقوفة — اختر فئة فعّالة.', { categoryId });
    return this.categories.effectiveAttributes(categoryId);
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
    effective: readonly EffectiveAttribute[],
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
            `خيار في المتغيّر «${sku}» يشير إلى سمة ليست من سمات المتغيّرات في هذه الفئة.`,
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
    effective: readonly EffectiveAttribute[],
  ): ResolvedAttribute[] {
    const byId = new Map(effective.map((a) => [a.attributeId, a]));
    const seen = new Set<string>();

    return inputs.map((input) => {
      const attribute = byId.get(input.attributeId);
      if (!attribute) {
        throw new InvalidInputError('سمة ليست من سمات هذه الفئة.', { attributeId: input.attributeId });
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

  private asInput(v: ProductDetailRow['variants'][number], currency: string): VariantInput {
    return {
      id: v.id,
      sku: v.sku,
      price: toDecimalString(money(v.priceMinorUnits, currency)),
      compareAtPrice:
        v.compareAtPriceMinorUnits !== null
          ? toDecimalString(money(v.compareAtPriceMinorUnits, currency))
          : null,
      barcode: v.barcode,
      weightGrams: v.weightGrams,
      options: v.optionValues.map((o) => ({ attributeId: o.attributeId, valueId: o.attributeValueId })),
    };
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
      category: row.category,
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
}

const hasVariants = (variants: readonly { options: readonly OptionChoice[] }[]): boolean =>
  variants.length > 1 || (variants[0]?.options.length ?? 0) > 0;

/** السمة الإلزامية تُستوفى على المنتج أو على المتغيّرات (المقاس الإلزامي يحمله كل متغيّر) */
function providedAttributeIds(
  attributes: readonly { attributeId: string }[],
  variants: readonly { options: readonly OptionChoice[] }[],
): Set<string> {
  const ids = new Set(attributes.map((a) => a.attributeId));
  for (const v of variants) for (const o of v.options) ids.add(o.attributeId);
  return ids;
}

function asAttributeInput(a: ProductDetailRow['attrValues'][number]): AttributeInput {
  return {
    attributeId: a.attributeId,
    ...(a.attributeValueId !== null ? { valueId: a.attributeValueId } : {}),
    ...(a.valueTextAr !== null ? { text: a.valueTextAr } : {}),
    ...(a.valueTextEn !== null ? { textEn: a.valueTextEn } : {}),
    ...(a.valueNumber !== null ? { number: a.valueNumber.toNumber() } : {}),
    ...(a.valueBoolean !== null ? { boolean: a.valueBoolean } : {}),
  };
}
