import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';

/** حدّ معقول لدفتر عناوين شخص — يمنع الإغراق ولا يضيّق على أحد */
export const MAX_ADDRESSES = 20;

/** مهلة «تراجع» بعد الحذف — الشاشة تعرضها ثوانيَ، والخادم يتسامح دقائق */
export const RESTORE_WINDOW_MS = 15 * 60_000;

export interface AddressInput {
  label?: string | null | undefined;
  recipientName: string;
  phone: string;
  country: string;
  region: string;
  city: string;
  area?: string | null | undefined;
  street: string;
  building?: string | null | undefined;
  floor?: string | null | undefined;
  landmark?: string | null | undefined;
}

export type AddressPatch = Partial<AddressInput>;

export interface AddressView {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  country: string;
  region: string;
  city: string;
  area: string | null;
  street: string;
  building: string | null;
  floor: string | null;
  landmark: string | null;
  isDefault: boolean;
}

const SELECT = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  country: true,
  region: true,
  city: true,
  area: true,
  street: true,
  building: true,
  floor: true,
  landmark: true,
  isDefault: true,
} as const satisfies Prisma.AddressSelect;

const NOT_FOUND = 'العنوان غير موجود. حدّث الصفحة لترى عناوينك الحالية.';

/** نصّ اختياري: الفراغ يعني «امسح الحقل» لا «احفظ نصّاً فارغاً» */
const optional = (v: string | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim();

function toData(input: AddressPatch): Prisma.AddressUncheckedUpdateInput {
  const data: Prisma.AddressUncheckedUpdateInput = {};
  if (input.recipientName !== undefined) data.recipientName = input.recipientName.trim();
  if (input.phone !== undefined) data.phone = input.phone.trim();
  if (input.country !== undefined) data.country = input.country.toUpperCase();
  if (input.region !== undefined) data.region = input.region.trim();
  if (input.city !== undefined) data.city = input.city.trim();
  if (input.street !== undefined) data.street = input.street.trim();
  for (const k of ['label', 'area', 'building', 'floor', 'landmark'] as const) {
    const v = optional(input[k]);
    if (v !== undefined) data[k] = v;
  }
  return data;
}

/**
 * ST-26 — دفتر عناوين المشتري.
 *
 * **كل استعلام هنا يحمل `userId` الفاعل** — لا دالة تقرأ أو تكتب عنواناً
 * بمعرّفه وحده. عنوان مستخدم آخر يُرجع 404 كالمعرّف غير الموجود (ADR-010):
 * الرد لا يكشف وجوده.
 *
 * **عنوان افتراضي واحد بالضبط** لكل من له عنوان حيّ. لا قيد فريد جزئي في
 * المخطط، فالقاعدة تُفرض بقفل صف المستخدم `FOR NO KEY UPDATE` أول كل معاملة
 * تمسّ الافتراضي: عمليتان متزامنتان للمستخدم نفسه تتتاليان ولا تتداخلان.
 * بلا القفل، «اجعله الافتراضي» مرتين معاً تُبقيان عنوانين افتراضيين — كل
 * معاملة تمسح ما رأته افتراضياً عند بدئها ثم ترفع عنوانها. واختيار
 * `NO KEY` مقصود: لا يحجب إدراج صفوف تشير إلى المستخدم (طلب، إشعار).
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<AddressView[]> {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      select: SELECT,
    });
  }

  async get(userId: string, id: string): Promise<AddressView> {
    const a = await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null }, select: SELECT });
    if (!a) throw new NotFoundError(NOT_FOUND);
    return a;
  }

  async create(userId: string, input: AddressInput, makeDefault = false): Promise<AddressView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId);
      const live = await tx.address.count({ where: { userId, deletedAt: null } });
      if (live >= MAX_ADDRESSES) {
        throw new ConflictError(`بلغت ${MAX_ADDRESSES} عنواناً محفوظاً. احذف عنواناً لا تستعمله ثم أضف الجديد.`);
      }
      const hasDefault = live > 0 && (await tx.address.count({ where: { userId, deletedAt: null, isDefault: true } })) > 0;
      // أول عنوان افتراضي تلقائياً: الدفع يجد عنواناً جاهزاً بلا خطوة إضافية
      const isDefault = makeDefault || !hasDefault;
      if (isDefault) await this.clearDefault(tx, userId);
      return tx.address.create({
        data: {
          userId,
          isDefault,
          recipientName: input.recipientName.trim(),
          phone: input.phone.trim(),
          country: input.country.toUpperCase(),
          region: input.region.trim(),
          city: input.city.trim(),
          street: input.street.trim(),
          label: optional(input.label) ?? null,
          area: optional(input.area) ?? null,
          building: optional(input.building) ?? null,
          floor: optional(input.floor) ?? null,
          landmark: optional(input.landmark) ?? null,
        },
        select: SELECT,
      });
    });
  }

  async update(userId: string, id: string, patch: AddressPatch, makeDefault = false): Promise<AddressView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId);
      await this.ownLive(tx, userId, id);
      if (makeDefault) await this.clearDefault(tx, userId, id);
      const r = await tx.address.updateMany({
        where: { id, userId, deletedAt: null },
        data: { ...toData(patch), ...(makeDefault ? { isDefault: true } : {}) },
      });
      if (r.count !== 1) throw new NotFoundError(NOT_FOUND);
      return tx.address.findFirstOrThrow({ where: { id, userId }, select: SELECT });
    });
  }

  async setDefault(userId: string, id: string): Promise<AddressView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId);
      await this.ownLive(tx, userId, id);
      await this.clearDefault(tx, userId, id);
      await tx.address.updateMany({ where: { id, userId }, data: { isDefault: true } });
      return tx.address.findFirstOrThrow({ where: { id, userId }, select: SELECT });
    });
  }

  /** حذف ناعم — الطلبات السابقة تحمل لقطة عنوانها، فلا يتأثّر شيء بالحذف */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId);
      const a = await this.ownLive(tx, userId, id);
      await tx.address.updateMany({ where: { id, userId }, data: { deletedAt: new Date(), isDefault: false } });
      // حُذف الافتراضي: يخلفه عنوان حيّ آخر، فلا يبقى دفتر بلا افتراضي
      if (a.isDefault) await this.promoteAny(tx, userId);
    });
  }

  /** «تراجع» عن الحذف — خلال المهلة، ويعود غير افتراضي إلا إن لم يبقَ افتراضي */
  async restore(userId: string, id: string): Promise<AddressView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId);
      const a = await tx.address.findFirst({ where: { id, userId, deletedAt: { not: null } }, select: { deletedAt: true } });
      if (!a) throw new NotFoundError(NOT_FOUND);
      if (Date.now() - a.deletedAt!.getTime() > RESTORE_WINDOW_MS) {
        throw new ConflictError('انقضت مهلة التراجع عن حذف هذا العنوان. أضفه من جديد إن احتجته.');
      }
      const live = await tx.address.count({ where: { userId, deletedAt: null } });
      if (live >= MAX_ADDRESSES) {
        throw new ConflictError(`بلغت ${MAX_ADDRESSES} عنواناً محفوظاً. احذف عنواناً لا تستعمله ثم استرجع هذا.`);
      }
      const hasDefault = (await tx.address.count({ where: { userId, deletedAt: null, isDefault: true } })) > 0;
      await tx.address.updateMany({ where: { id, userId }, data: { deletedAt: null, isDefault: !hasDefault } });
      return tx.address.findFirstOrThrow({ where: { id, userId }, select: SELECT });
    });
  }

  // ------------------------------------------------------------ داخلي

  /** يسلسل كل ما يمسّ دفتر عناوين المستخدم الواحد — انظر تعليق الصنف */
  private async lockOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
    if (rows.length === 0) throw new NotFoundError(NOT_FOUND);
  }

  private async ownLive(tx: Prisma.TransactionClient, userId: string, id: string) {
    const a = await tx.address.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, isDefault: true } });
    if (!a) throw new NotFoundError(NOT_FOUND);
    return a;
  }

  private clearDefault(tx: Prisma.TransactionClient, userId: string, except?: string) {
    return tx.address.updateMany({
      where: { userId, isDefault: true, ...(except ? { id: { not: except } } : {}) },
      data: { isDefault: false },
    });
  }

  private async promoteAny(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const next = await tx.address.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (next) await tx.address.updateMany({ where: { id: next.id, userId }, data: { isDefault: true } });
  }
}
