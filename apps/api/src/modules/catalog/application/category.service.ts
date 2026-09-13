import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  DuplicateError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  ancestorPaths,
  buildTree,
  placementUnder,
  planMove,
  type TreeNode,
} from '../domain/category-tree';

export const ATTRIBUTE_INPUT_TYPES = ['select', 'multiselect', 'number', 'text', 'boolean'] as const;
export type AttributeInputType = (typeof ATTRIBUTE_INPUT_TYPES)[number];

export interface CategoryView {
  id: string;
  parentId: string | null;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  iconKey: string | null;
  depth: number;
  sort: number;
}

export interface EffectiveAttribute {
  attributeId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  inputType: string;
  unit: string | null;
  isFilterable: boolean;
  isVariantAxis: boolean;
  /** إلزامي إن ألزمته الفئة أو أحد أسلافها — الفرع لا يُرخي شرط أصله */
  isRequired: boolean;
  /** الفئة التي عرّفت السمة — قد تكون سلفاً لا الفئة نفسها */
  definedOn: string;
  values: { id: string; valueAr: string; valueEn: string | null; hexColor: string | null }[];
}

export const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const CATEGORY_VIEW = {
  id: true,
  parentId: true,
  slug: true,
  nameAr: true,
  nameEn: true,
  iconKey: true,
  depth: true,
  sort: true,
} as const;

/**
 * شجرة الفئات وسماتها — عمل إداري بصلاحية catalog.manage.
 *
 * لا حذف للفئات: فئة عليها منتجات تحملها لقطات عمولة وطلبات سابقة.
 * الإيقاف (isActive = false) يُخفيها وفرعها من الشجرة العامة.
 */
@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async tree(): Promise<TreeNode<CategoryView>[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: CATEGORY_VIEW,
    });
    return buildTree(rows);
  }

  async create(input: {
    parentId?: string | null | undefined;
    slug: string;
    nameAr: string;
    nameEn?: string | null | undefined;
    iconKey?: string | null | undefined;
    sort?: number | undefined;
  }): Promise<CategoryView> {
    const parent = input.parentId
      ? await this.prisma.category.findUnique({
          where: { id: input.parentId },
          select: { path: true, depth: true },
        })
      : null;
    if (input.parentId && !parent) throw new NotFoundError('الفئة الأب غير موجودة.');

    const id = randomUUID();
    const placement = placementUnder(parent, id);

    try {
      return await this.prisma.category.create({
        data: {
          id,
          parentId: input.parentId ?? null,
          path: placement.path,
          depth: placement.depth,
          slug: input.slug,
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          iconKey: input.iconKey ?? null,
          sort: input.sort ?? 0,
        },
        select: CATEGORY_VIEW,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateError(`المعرّف «${input.slug}» مستعمل لفئة أخرى.`, { slug: input.slug });
      }
      throw err;
    }
  }

  async update(
    id: string,
    input: {
      slug?: string | undefined;
      nameAr?: string | undefined;
      nameEn?: string | null | undefined;
      iconKey?: string | null | undefined;
      sort?: number | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<CategoryView> {
    const data: Prisma.CategoryUpdateInput = {};
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.nameAr !== undefined) data.nameAr = input.nameAr;
    if (input.nameEn !== undefined) data.nameEn = input.nameEn;
    if (input.iconKey !== undefined) data.iconKey = input.iconKey;
    if (input.sort !== undefined) data.sort = input.sort;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    try {
      return await this.prisma.category.update({ where: { id }, data, select: CATEGORY_VIEW });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundError('الفئة غير موجودة.', { id });
      }
      if (isUniqueViolation(err)) {
        throw new DuplicateError(`المعرّف «${input.slug}» مستعمل لفئة أخرى.`, { slug: input.slug });
      }
      throw err;
    }
  }

  /** نقل الفئة بفرعها: مسارات الفرع كله تُعاد كتابتها في جملة واحدة داخل معاملة. */
  async move(id: string, newParentId: string | null): Promise<CategoryView> {
    return this.prisma.$transaction(async (tx) => {
      const node = await tx.category.findUnique({
        where: { id },
        select: { id: true, path: true, depth: true },
      });
      if (!node) throw new NotFoundError('الفئة غير موجودة.', { id });

      const parent = newParentId
        ? await tx.category.findUnique({
            where: { id: newParentId },
            select: { path: true, depth: true },
          })
        : null;
      if (newParentId && !parent) throw new NotFoundError('الفئة الأب غير موجودة.');

      const deepest = await tx.category.aggregate({
        where: { path: { startsWith: node.path } },
        _max: { depth: true },
      });
      const plan = planMove(node, parent, deepest._max.depth ?? node.depth);

      // المسارات مبنية من معرّفات فقط، فلا _ ولا % فيها تفسد LIKE.
      // ::int صريح: Prisma يرسل رقم JS كـ bigint، ولا توجد substr(text, bigint) —
      // كشفه اختبار النقل، ولولاه لفشل مسار النقل الإداري في أول استعمال
      await tx.$executeRaw`
        UPDATE "categories"
        SET "path" = ${plan.newPrefix} || substr("path", ${plan.oldPrefix.length + 1}::int),
            "depth" = "depth" + ${plan.depthShift}::int
        WHERE "path" LIKE ${`${plan.oldPrefix}%`}`;

      return tx.category.update({
        where: { id },
        data: { parentId: newParentId },
        select: CATEGORY_VIEW,
      });
    });
  }

  // ---------------------------------------------------------------- السمات

  async createAttribute(input: {
    code: string;
    nameAr: string;
    nameEn?: string | null | undefined;
    inputType: AttributeInputType;
    unit?: string | null | undefined;
    isFilterable?: boolean | undefined;
    isVariantAxis?: boolean | undefined;
    sort?: number | undefined;
    values?: readonly { valueAr: string; valueEn?: string | null | undefined; hexColor?: string | null | undefined }[] | undefined;
  }) {
    if (input.isVariantAxis && input.inputType !== 'select') {
      throw new InvalidInputError(
        'سمة المتغيّرات (مثل المقاس) تكون من نوع «اختيار من قائمة» — لكل متغيّر قيمة واحدة معرّفة.',
      );
    }
    assertDistinctValues((input.values ?? []).map((v) => v.valueAr));

    try {
      return await this.prisma.attribute.create({
        data: {
          code: input.code,
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          inputType: input.inputType,
          unit: input.unit ?? null,
          isFilterable: input.isFilterable ?? true,
          isVariantAxis: input.isVariantAxis ?? false,
          sort: input.sort ?? 0,
          values: {
            create: (input.values ?? []).map((v, i) => ({
              valueAr: v.valueAr,
              valueEn: v.valueEn ?? null,
              hexColor: v.hexColor ?? null,
              sort: i,
            })),
          },
        },
        include: { values: { orderBy: { sort: 'asc' } } },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateError(`رمز السمة «${input.code}» مستعمل.`, { code: input.code });
      }
      throw err;
    }
  }

  async addAttributeValue(
    attributeId: string,
    input: { valueAr: string; valueEn?: string | null | undefined; hexColor?: string | null | undefined },
  ) {
    const attribute = await this.prisma.attribute.findUnique({
      where: { id: attributeId },
      include: { values: { select: { valueAr: true, sort: true } } },
    });
    if (!attribute) throw new NotFoundError('السمة غير موجودة.', { attributeId });
    assertDistinctValues([...attribute.values.map((v) => v.valueAr), input.valueAr]);

    return this.prisma.attributeValue.create({
      data: {
        attributeId,
        valueAr: input.valueAr,
        valueEn: input.valueEn ?? null,
        hexColor: input.hexColor ?? null,
        sort: attribute.values.reduce((max, v) => Math.max(max, v.sort + 1), 0),
      },
    });
  }

  async linkAttribute(
    categoryId: string,
    attributeId: string,
    input: { isRequired: boolean; sort?: number | undefined },
  ): Promise<void> {
    const [category, attribute] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }),
      this.prisma.attribute.findUnique({ where: { id: attributeId }, select: { id: true } }),
    ]);
    if (!category) throw new NotFoundError('الفئة غير موجودة.', { categoryId });
    if (!attribute) throw new NotFoundError('السمة غير موجودة.', { attributeId });

    await this.prisma.categoryAttribute.upsert({
      where: { categoryId_attributeId: { categoryId, attributeId } },
      create: { categoryId, attributeId, isRequired: input.isRequired, sort: input.sort ?? 0 },
      update: { isRequired: input.isRequired, ...(input.sort !== undefined ? { sort: input.sort } : {}) },
    });
  }

  async unlinkAttribute(categoryId: string, attributeId: string): Promise<void> {
    await this.prisma.categoryAttribute.deleteMany({ where: { categoryId, attributeId } });
  }

  /**
   * سمات الفئة مع ما ترثه من أسلافها: هاتف تحت «إلكترونيات» يرث «الضمان».
   * استعلام واحد على بادئات المسار، لا صعود متكرّر في الشجرة.
   */
  async effectiveAttributes(categoryId: string): Promise<EffectiveAttribute[]> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { path: true, isActive: true },
    });
    if (!category) throw new NotFoundError('الفئة غير موجودة.', { categoryId });

    const links = await this.prisma.categoryAttribute.findMany({
      where: { category: { path: { in: ancestorPaths(category.path) } } },
      include: {
        category: { select: { id: true, depth: true } },
        attribute: { include: { values: { orderBy: { sort: 'asc' } } } },
      },
    });

    const merged = new Map<string, EffectiveAttribute & { order: number }>();
    for (const link of links.sort((a, b) => a.category.depth - b.category.depth)) {
      const a = link.attribute;
      const prev = merged.get(a.id);
      merged.set(a.id, {
        attributeId: a.id,
        code: a.code,
        nameAr: a.nameAr,
        nameEn: a.nameEn,
        inputType: a.inputType,
        unit: a.unit,
        isFilterable: a.isFilterable,
        isVariantAxis: a.isVariantAxis,
        isRequired: (prev?.isRequired ?? false) || link.isRequired,
        definedOn: prev?.definedOn ?? link.category.id,
        order: prev?.order ?? link.sort,
        values: a.values.map((v) => ({
          id: v.id,
          valueAr: v.valueAr,
          valueEn: v.valueEn,
          hexColor: v.hexColor,
        })),
      });
    }

    return [...merged.values()]
      .sort((x, y) => x.order - y.order)
      .map(({ order: _order, ...rest }) => rest);
  }
}

function assertDistinctValues(values: readonly string[]): void {
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (seen.has(key)) {
      throw new DuplicateError(`القيمة «${v}» مكررة في السمة — الاستيراد يطابق بالاسم فلا يُقبل تكراره.`);
    }
    seen.add(key);
  }
}
