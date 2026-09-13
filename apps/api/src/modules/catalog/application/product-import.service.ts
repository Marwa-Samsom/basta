import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ScopedRepository } from '../../../common/prisma/scoped-repository';
import type { Actor, VendorScope } from '../../../common/security/actor';
import { InventoryService } from '../../inventory/public';
import { VendorDirectory } from '../../vendors/public';
import { ancestorPaths } from '../domain/category-tree';
import {
  IMPORT_COLUMNS,
  ImportFileRejectedError,
  lookupKey,
  parseRow,
  planImport,
  resolveHeaders,
  type AxisLookup,
  type ImportLookups,
  type ImportPlan,
  type ParsedRow,
  type RejectedLine,
} from '../domain/import-plan';
import { productSlug } from '../domain/slug';
import { readImportFile } from '../infrastructure/import-file-reader';
import { isUniqueViolation } from './category.service';

export interface ImportReport {
  readonly importId: string;
  readonly format: 'csv' | 'xlsx';
  /** أسطر البيانات غير الفارغة في الملف */
  readonly totalRows: number;
  /** ما كُتب فعلاً: متغيّرات أُنشئت + متغيّرات حُدّثت */
  readonly imported: number;
  readonly productsCreated: number;
  readonly variantsCreated: number;
  readonly variantsUpdated: number;
  readonly rejectedCount: number;
  readonly rejected: readonly RejectedLine[];
}

const csvCell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * الاستيراد الجماعي — SRS V-03، بوابة المرحلة 05 البند الثالث.
 *
 * القرار سطراً سطراً في domain/import-plan بلا قاعدة بيانات، والكتابة كلها
 * هنا في معاملة واحدة. المنتجات المستوردة مسودّات: النشر قرار البائع بعد
 * مراجعة الصور والسمات، لا أثر جانبي لرفع ملف.
 */
@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly vendors: VendorDirectory,
  ) {}

  /** قالب CSV عربي بسطرين مثالين لمنتج بمتغيّرين. BOM ليفتحه Excel بالعربية صحيحة. */
  templateCsv(): string {
    const rows = [
      IMPORT_COLUMNS.map((c) => c.header),
      IMPORT_COLUMNS.map((c) => c.example[0]),
      IMPORT_COLUMNS.map((c) => c.example[1]),
    ];
    return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  async import(scope: VendorScope, actor: Actor, file: Buffer): Promise<ImportReport> {
    const sheet = await readImportFile(file);
    const columns = resolveHeaders(sheet.headers);
    const vendor = await this.vendors.get(scope.vendorId);

    const parsed: ParsedRow[] = [];
    const rejectedAtParse: RejectedLine[] = [];
    for (const row of sheet.rows) {
      const result = parseRow(row.cells, columns, row.line, vendor.settlementCurrency);
      if (result.ok) parsed.push(result.row);
      else rejectedAtParse.push(result.rejected);
    }

    const plan = await this.guardReservedStock(
      planImport(parsed, rejectedAtParse, await this.lookups(scope, parsed)),
    );
    const importId = randomUUID();
    const written = await this.apply(scope, actor, importId, plan);

    return {
      importId,
      format: sheet.format,
      totalRows: sheet.rows.length,
      imported: written.variantsCreated + plan.updates.length,
      productsCreated: plan.products.length,
      variantsCreated: written.variantsCreated,
      variantsUpdated: plan.updates.length,
      rejectedCount: plan.rejected.length,
      rejected: plan.rejected,
    };
  }

  private async lookups(scope: VendorScope, rows: readonly ParsedRow[]): Promise<ImportLookups> {
    const skus = [...new Set(rows.map((r) => r.sku))];
    const [categories, axisLinks, axes, existing] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, nameAr: true, nameEn: true, path: true },
      }),
      this.prisma.categoryAttribute.findMany({
        where: { attribute: { isVariantAxis: true } },
        select: { attributeId: true, category: { select: { path: true } } },
      }),
      this.prisma.attribute.findMany({
        where: { isVariantAxis: true },
        include: { values: { orderBy: { sort: 'asc' } } },
      }),
      skus.length > 0
        ? (new ScopedRepository<{ id: string; sku: string; productId: string }>(
            this.prisma.productVariant as never,
            scope,
            'المتغيّر',
          ).findMany({
            where: { sku: { in: skus }, archivedAt: null },
            select: { id: true, sku: true, productId: true },
          }) as Promise<{ id: string; sku: string; productId: string }[]>)
        : Promise.resolve([]),
    ]);

    const axesByPath = new Map<string, Set<string>>();
    for (const link of axisLinks) {
      const set = axesByPath.get(link.category.path) ?? new Set<string>();
      set.add(link.attributeId);
      axesByPath.set(link.category.path, set);
    }

    const categoryMap = new Map<string, { id: string; nameAr: string; axisIds: Set<string> }>();
    const entries = categories.map((c) => {
      const axisIds = new Set<string>();
      for (const path of ancestorPaths(c.path)) {
        for (const id of axesByPath.get(path) ?? []) axisIds.add(id);
      }
      return { category: c, entry: { id: c.id, nameAr: c.nameAr, axisIds } };
    });
    // الأسماء أولاً ثم المعرّفات النصّية: المعرّف فريد، فيغلب إن تشابه مع اسم فئة أخرى
    for (const { category, entry } of entries) {
      categoryMap.set(lookupKey(category.nameAr), entry);
      if (category.nameEn) categoryMap.set(lookupKey(category.nameEn), entry);
    }
    for (const { category, entry } of entries) categoryMap.set(lookupKey(category.slug), entry);

    const axisMap = new Map<string, AxisLookup>();
    for (const a of axes) {
      const values = new Map<string, string>();
      for (const v of a.values) {
        values.set(lookupKey(v.valueAr), v.id);
        if (v.valueEn) values.set(lookupKey(v.valueEn), v.id);
      }
      const lookup: AxisLookup = {
        id: a.id,
        nameAr: a.nameAr,
        values,
        valueLabels: a.values.map((v) => v.valueAr),
      };
      axisMap.set(lookupKey(a.code), lookup);
      axisMap.set(lookupKey(a.nameAr), lookup);
      if (a.nameEn) axisMap.set(lookupKey(a.nameEn), lookup);
    }

    return {
      categories: categoryMap,
      axes: axisMap,
      existingSkus: new Map(existing.map((v) => [v.sku, { variantId: v.id, productId: v.productId }])),
    };
  }

  /**
   * سطر يحدّث كمية دون المحجوز يُرفض كسطر لا يُسقط الملف.
   * الفحص قبل المعاملة لرسالة تسمّي السطر؛ القفل داخلها يبقى الحكم عند السباق.
   */
  private async guardReservedStock(plan: ImportPlan): Promise<ImportPlan> {
    if (plan.updates.length === 0) return plan;
    const levels = new Map(
      (await this.inventory.levels(plan.updates.map((u) => u.variantId))).map((l) => [l.variantId, l]),
    );

    const rejected = [...plan.rejected];
    const updates = plan.updates.filter((u) => {
      const reserved = levels.get(u.variantId)?.reserved ?? 0;
      if (u.stock >= reserved) return true;
      rejected.push({
        line: u.line,
        sku: u.sku,
        reasons: [
          {
            column: 'الكمية',
            message: `محجوز منها ${reserved} لمشترين في صفحة الدفع الآن — لا تقل الكمية عن ${reserved}.`,
          },
        ],
      });
      return false;
    });

    return { ...plan, updates, rejected: rejected.sort((a, b) => a.line - b.line) };
  }

  private async apply(
    scope: VendorScope,
    actor: Actor,
    importId: string,
    plan: ImportPlan,
  ): Promise<{ variantsCreated: number }> {
    if (plan.products.length === 0 && plan.updates.length === 0) return { variantsCreated: 0 };

    const products = plan.products.map((p) => ({ id: randomUUID(), product: p }));
    const variants = products.flatMap(({ id: productId, product }) =>
      product.variants.map((variant) => ({ id: randomUUID(), productId, variant })),
    );
    const movementCtx = { reason: 'import' as const, actorUserId: actor.userId, refType: 'import', refId: importId };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (products.length > 0) {
            await tx.product.createMany({
              data: products.map(({ id, product }) => ({
                id,
                vendorId: scope.vendorId,
                categoryId: product.categoryId,
                slug: productSlug(product.nameEn, randomBytes(4).toString('hex')),
                nameAr: product.nameAr,
                nameEn: product.nameEn,
                descriptionAr: product.descriptionAr,
                descriptionEn: product.descriptionEn,
                hasVariants: product.variants.length > 1 || (product.variants[0]?.options.length ?? 0) > 0,
              })),
            });
            await tx.productVariant.createMany({
              data: variants.map(({ id, productId, variant }) => ({
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
            const options = variants.flatMap(({ id, variant }) =>
              variant.options.map((o) => ({ variantId: id, attributeId: o.attributeId, attributeValueId: o.valueId })),
            );
            if (options.length > 0) await tx.variantOptionValue.createMany({ data: options });

            await this.inventory.initialize(
              tx,
              variants.map(({ id, variant }) => ({
                variantId: id,
                onHand: variant.stock,
                lowStockThreshold: variant.lowStockThreshold,
              })),
              movementCtx,
            );
          }

          const scopedVariants = new ScopedRepository(tx.productVariant as never, scope, 'المتغيّر');
          // بترتيب المعرّف: قفل المخزون بالترتيب نفسه الذي يقفل به الحجز
          const updates = [...plan.updates].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
          for (const u of updates) {
            try {
              await scopedVariants.updateOwned(u.variantId, {
                priceMinorUnits: u.priceMinorUnits,
                compareAtPriceMinorUnits: u.compareAtPriceMinorUnits,
              });
              await this.inventory.adjust(
                { variantId: u.variantId, change: { setTo: u.stock }, lowStockThreshold: u.lowStockThreshold },
                { ...movementCtx, note: `السطر ${u.line}` },
                tx,
              );
            } catch (err) {
              if (err instanceof DomainError) {
                throw new ImportFileRejectedError(
                  `السطر ${u.line} (${u.sku}): ${err.message} لم يُكتب شيء من الملف — أصلح السطر وأعد الرفع.`,
                );
              }
              throw err;
            }
          }
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ImportFileRejectedError(
          'تغيّرت منتجات المتجر أثناء الاستيراد (أُضيف SKU من مسار آخر). لم يُكتب شيء من الملف — أعد رفعه.',
        );
      }
      throw err;
    }

    return { variantsCreated: variants.length };
  }
}
