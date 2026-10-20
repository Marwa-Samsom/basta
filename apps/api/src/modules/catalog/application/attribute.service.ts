import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
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
