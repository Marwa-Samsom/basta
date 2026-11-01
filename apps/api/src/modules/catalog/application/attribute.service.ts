import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictError,
  DuplicateError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';

export const ATTRIBUTE_INPUT_TYPES = ['select', 'multiselect', 'number', 'text', 'boolean'] as const;
export type AttributeInputType = (typeof ATTRIBUTE_INPUT_TYPES)[number];

/** سمة كما يراها محرّر المنتج — أي سمة متاحة لأي منتج */
export interface AttributeView {
  attributeId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  inputType: string;
  unit: string | null;
  isFilterable: boolean;
  isVariantAxis: boolean;
  /** مؤرشفة: لا تُختار لمنتج جديد، وتبقى لمنتج يستعملها من قبل */
  archived: boolean;
  values: { id: string; valueAr: string; valueEn: string | null; hexColor: string | null }[];
}

export const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * مكتبة السمات (اللون، المقاس، الضمان…) — عمل إداري بصلاحية catalog.manage.
 *
 * كانت السمة تُربط بفئة عامة فيرثها فرعها، وتلزم بها. سقطت الفئات العامة
 * (قرار صاحب المشروع 14 أكتوبر 2026) فصارت كل سمة متاحة لكل منتج ولا إلزام.
 */
@Injectable()
export class AttributeService {
  constructor(private readonly prisma: PrismaService) {}

  /** كل السمات بقيمها — ما يعرضه محرّر المنتج ويتحقّق منه الخادم */
  async all(): Promise<AttributeView[]> {
    const rows = await this.prisma.attribute.findMany({
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
      include: { values: { orderBy: { sort: 'asc' } } },
    });
    return rows.map((a) => ({
      attributeId: a.id,
      code: a.code,
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      inputType: a.inputType,
      unit: a.unit,
      isFilterable: a.isFilterable,
      isVariantAxis: a.isVariantAxis,
      archived: a.archivedAt !== null,
      values: a.values.map((v) => ({ id: v.id, valueAr: v.valueAr, valueEn: v.valueEn, hexColor: v.hexColor })),
    }));
  }

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

  // ------------------------------------------------ التصحيح والحذف والأرشفة
  // كانت الخصيصة تُنشأ وتُزاد قيمها فقط: الخطأ الإملائي لا يُصحَّح إلا من القاعدة،
  // ولا حذف ولا أرشفة، ولا يُرى كم منتجاً يستعملها (ACFG-099، 1 نوفمبر 2026)

  /** الاسم والوحدة والتصفية تُصحَّح؛ الرمز والنوع والمحور ثابتة — تغييرها يكسر ما يستعملها */
  async updateAttribute(id: string, input: { nameAr?: string | undefined; unit?: string | null | undefined; isFilterable?: boolean | undefined }) {
    const before = await this.prisma.attribute.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('السمة غير موجودة.', { attributeId: id });
    const nameAr = input.nameAr?.trim();
    if (input.nameAr !== undefined && (!nameAr || nameAr.length < 2)) {
      throw new InvalidInputError('اسم الخصيصة حرفان على الأقل.', { field: 'nameAr' });
    }
    const after = await this.prisma.attribute.update({
      where: { id },
      data: {
        ...(nameAr ? { nameAr } : {}),
        ...(input.unit !== undefined ? { unit: input.unit?.trim() || null } : {}),
        ...(input.isFilterable !== undefined ? { isFilterable: input.isFilterable } : {}),
      },
    });
    return {
      before: { nameAr: before.nameAr, unit: before.unit, isFilterable: before.isFilterable },
      after: { nameAr: after.nameAr, unit: after.unit, isFilterable: after.isFilterable },
    };
  }

  /** تصحيح قيمة باسمها: المنتجات تشير إليها بمعرّفها فيصلها التصحيح كلها */
  async updateValue(attributeId: string, valueId: string, valueAr: string) {
    const attribute = await this.prisma.attribute.findUnique({
      where: { id: attributeId },
      include: { values: { select: { id: true, valueAr: true } } },
    });
    const value = attribute?.values.find((v) => v.id === valueId);
    if (!attribute || !value) throw new NotFoundError('القيمة غير موجودة في هذه السمة.', { attributeId, valueId });
    const name = valueAr.trim();
    if (!name) throw new InvalidInputError('القيمة لا تكون فارغة.', { field: 'valueAr' });
    assertDistinctValues([...attribute.values.filter((v) => v.id !== valueId).map((v) => v.valueAr), name]);
    await this.prisma.attributeValue.update({ where: { id: valueId }, data: { valueAr: name } });
    return { attribute: attribute.nameAr, before: value.valueAr, after: name };
  }

  /** تُحذف القيمة التي لا يستعملها منتج ولا متغيّر ولا صورة؛ المستعملة يُصحَّح اسمها */
  async deleteValue(attributeId: string, valueId: string) {
    const value = await this.prisma.attributeValue.findFirst({
      where: { id: valueId, attributeId },
      include: {
        attribute: { select: { nameAr: true } },
        _count: { select: { productValues: true, variantOptions: true, productImages: true } },
      },
    });
    if (!value) throw new NotFoundError('القيمة غير موجودة في هذه السمة.', { attributeId, valueId });
    const used = value._count.productValues + value._count.variantOptions + value._count.productImages;
    if (used > 0) {
      throw new ConflictError(`«${value.valueAr}» مستعملة في ${used} منتجاً أو متغيّراً أو صورة — صحّح اسمها بدل حذفها.`, { used });
    }
    await this.prisma.attributeValue.delete({ where: { id: valueId } });
    return { attribute: value.attribute.nameAr, valueAr: value.valueAr };
  }

  /** تُحذف الخصيصة التي لا يستعملها منتج؛ المستعملة تُؤرشف */
  async deleteAttribute(id: string) {
    const attribute = await this.prisma.attribute.findUnique({
      where: { id },
      include: { values: { select: { valueAr: true } }, _count: { select: { productValues: true, variantOptions: true } } },
    });
    if (!attribute) throw new NotFoundError('السمة غير موجودة.', { attributeId: id });
    const used = attribute._count.productValues + attribute._count.variantOptions;
    if (used > 0) {
      throw new ConflictError(
        `«${attribute.nameAr}» مستعملة في ${used} منتجاً أو متغيّراً — أرشفها بدل حذفها: تختفي من خيارات البائعين وتبقى عند منتجاتها.`,
        { used },
      );
    }
    // القيم تُحذف معها (Cascade)، ولا قيمة مستعملة ما دامت الخصيصة غير مستعملة إلا بصورة
    const images = await this.prisma.productImage.count({ where: { optionValue: { attributeId: id } } });
    if (images > 0) {
      throw new ConflictError(`قيم «${attribute.nameAr}» مربوطة بـ ${images} صورة منتج — أرشفها بدل حذفها.`, { used: images });
    }
    await this.prisma.attribute.delete({ where: { id } });
    return { code: attribute.code, nameAr: attribute.nameAr, inputType: attribute.inputType, values: attribute.values.map((v) => v.valueAr) };
  }

  async setArchived(id: string, archived: boolean) {
    const attribute = await this.prisma.attribute.findUnique({ where: { id }, select: { nameAr: true } });
    if (!attribute) throw new NotFoundError('السمة غير موجودة.', { attributeId: id });
    await this.prisma.attribute.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    return { nameAr: attribute.nameAr, archived };
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
