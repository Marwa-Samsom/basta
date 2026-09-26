import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  MAX_RATES_PER_ZONE,
  MAX_ZONES_PER_VENDOR,
  ShapeError,
  dedupeRegions,
  describeRegion,
  findTie,
  normalizeRegion,
  validateRate,
  type RateShape,
  type RegionShape,
} from '../domain/zones';

type Tx = Prisma.TransactionClient;

export interface RegionInput {
  country: string;
  region?: string | null | undefined;
  city?: string | null | undefined;
}

export interface RateInput {
  method: string;
  priceMinor: bigint;
  perKgMinor: bigint | null;
  freeOverMinor: bigint | null;
  minDays: number;
  maxDays: number;
}

export interface RatePatch {
  method?: string | undefined;
  priceMinor?: bigint | undefined;
  /** undefined = بلا تغيير، null = يُمسح */
  perKgMinor?: bigint | null | undefined;
  freeOverMinor?: bigint | null | undefined;
  minDays?: number | undefined;
  maxDays?: number | undefined;
  isActive?: boolean | undefined;
}

const zoneInclude = {
  regions: { orderBy: [{ country: 'asc' }, { region: 'asc' }, { city: 'asc' }] },
  rates: { orderBy: { id: 'asc' } },
} satisfies Prisma.ShippingZoneInclude;

type ZoneRow = Prisma.ShippingZoneGetPayload<{ include: typeof zoneInclude }>;

function present(z: ZoneRow) {
  return {
    id: z.id,
    nameAr: z.nameAr,
    isActive: z.isActive,
    regions: z.regions.map((r) => ({ id: r.id, country: r.country, region: r.region, city: r.city })),
    rates: z.rates.map((r) => ({
      id: r.id,
      method: r.method,
      priceMinorUnits: r.priceMinorUnits.toString(),
      perKgMinorUnits: r.perKgMinorUnits?.toString() ?? null,
      freeOverMinorUnits: r.freeOverMinorUnits?.toString() ?? null,
      minDays: r.minDays,
      maxDays: r.maxDays,
      isActive: r.isActive,
    })),
  };
}

const shape = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ShapeError) throw new InvalidInputError(e.message, { field: e.field });
    throw e;
  }
};

const rateData = (r: RateShape) => ({
  method: r.method,
  priceMinorUnits: r.priceMinor,
  perKgMinorUnits: r.perKgMinor,
  freeOverMinorUnits: r.freeOverMinor,
  minDays: r.minDays,
  maxDays: r.maxDays,
});

/**
 * مناطق الشحن للبائع — VD-16. كل استعلام مقيَّد بـ vendorId من نطاق الفاعل؛
 * منطقة بائع آخر «غير موجودة» (ADR-010) لا «ممنوعة».
 *
 * كل تعديل في معاملة تقفل صفّ البائع أولاً: تعديلان متزامنان على مناطقه
 * لا يمرّان معاً من فحص التعادل ثم يصنعان تعادلاً بعده. وبعد التعديل يُفحص
 * ما تقرؤه نواة التسعير (انظر domain/zones.ts) — والفشل يُرجع المعاملة كلها.
 */
@Injectable()
export class ShippingZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(vendorId: string) {
    const [vendor, zones] = await Promise.all([
      this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { settlementCurrency: true } }),
      this.prisma.shippingZone.findMany({ where: { vendorId }, include: zoneInclude, orderBy: [{ nameAr: 'asc' }, { id: 'asc' }] }),
    ]);
    return { currency: vendor.settlementCurrency, zones: zones.map(present) };
  }

  async createZone(
    vendorId: string,
    userId: string,
    input: { nameAr: string; isActive: boolean; regions: RegionInput[]; rates: RateInput[] },
  ) {
    const regions = shape(() => dedupeRegions(input.regions.map(normalizeRegion)));
    const rates = shape(() => input.rates.map(validateRate));
    if (rates.length > MAX_RATES_PER_ZONE) throw new InvalidInputError(`المنطقة تحمل ${MAX_RATES_PER_ZONE} تسعيرات على الأكثر.`);
    return this.prisma.$transaction(async (tx) => {
      await this.lockVendor(tx, vendorId);
      const count = await tx.shippingZone.count({ where: { vendorId } });
      if (count >= MAX_ZONES_PER_VENDOR) {
        throw new ConflictError(`بلغت ${MAX_ZONES_PER_VENDOR} منطقة — عدّل منطقة قائمة أو احذف واحدة لا تستعملها.`);
      }
      const zone = await tx.shippingZone.create({
        data: {
          vendorId,
          nameAr: input.nameAr.trim(),
          isActive: input.isActive,
          regions: { create: regions.map((r) => ({ country: r.country, region: r.region, city: r.city })) },
          rates: { create: rates.map(rateData) },
        },
        include: zoneInclude,
      });
      await this.assertCoherent(tx, vendorId, zone.id);
      const out = present(zone);
      await this.audit(tx, userId, 'shipping_zone.create', zone.id, null, out);
      return out;
    });
  }

  async updateZone(
    vendorId: string,
    userId: string,
    zoneId: string,
    patch: { nameAr?: string | undefined; isActive?: boolean | undefined; regions?: RegionInput[] | undefined },
  ) {
    const regions = patch.regions ? shape(() => dedupeRegions(patch.regions!.map(normalizeRegion))) : undefined;
    return this.prisma.$transaction(async (tx) => {
      await this.lockVendor(tx, vendorId);
      const before = await this.zoneOf(tx, vendorId, zoneId);
      if (regions) {
        await tx.shippingZoneRegion.deleteMany({ where: { zoneId } });
        await tx.shippingZoneRegion.createMany({
          data: regions.map((r) => ({ zoneId, country: r.country, region: r.region, city: r.city })),
        });
      }
      await tx.shippingZone.update({
        where: { id: zoneId },
        data: {
          ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr.trim() } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
      await this.assertCoherent(tx, vendorId, zoneId);
      const out = present(await tx.shippingZone.findUniqueOrThrow({ where: { id: zoneId }, include: zoneInclude }));
      await this.audit(tx, userId, 'shipping_zone.update', zoneId, present(before), out);
      return out;
    });
  }

  /**
   * الحذف آمن للطلبات: الفرعي يحفظ مبلغ شحنه ومدّته لحظة الطلب، ولا مرجع
   * له إلى المنطقة. ما يضيع هو التغطية نفسها — والواجهة تقول ذلك قبل الحذف.
   */
  async deleteZone(vendorId: string, userId: string, zoneId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockVendor(tx, vendorId);
      const before = await this.zoneOf(tx, vendorId, zoneId);
      await tx.shippingZone.delete({ where: { id: zoneId } });
      await this.audit(tx, userId, 'shipping_zone.delete', zoneId, present(before), null);
    });
  }

  async addRate(vendorId: string, userId: string, zoneId: string, input: RateInput) {
    const rate = shape(() => validateRate(input));
    return this.prisma.$transaction(async (tx) => {
      await this.lockVendor(tx, vendorId);
      const before = await this.zoneOf(tx, vendorId, zoneId);
      if (before.rates.length >= MAX_RATES_PER_ZONE) {
        throw new ConflictError(`المنطقة تحمل ${MAX_RATES_PER_ZONE} تسعيرات على الأكثر — عدّل تسعيرة قائمة.`);
      }
      await tx.shippingRate.create({ data: { zoneId, ...rateData(rate) } });
      await this.assertCoherent(tx, vendorId, zoneId);
      const out = present(await tx.shippingZone.findUniqueOrThrow({ where: { id: zoneId }, include: zoneInclude }));
      await this.audit(tx, userId, 'shipping_rate.create', zoneId, present(before), out);
      return out;
    });
  }

  /**
   * تعديل تسعيرة أو إيقافها. تبديل الطريقة يمسح حقول الطريقة السابقة ما لم
   * تُرسل صراحةً — فالتبديل من «حسب الوزن» إلى «ثابت» لا يُرفض بسعر كيلو
   * قديم لا يراه البائع. أمّا الحقل المرسل صراحةً لطريقة لا تقرؤه فمرفوض.
   */
  async updateRate(vendorId: string, userId: string, rateId: string, patch: RatePatch) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockVendor(tx, vendorId);
      const current = await tx.shippingRate.findFirst({ where: { id: rateId, zone: { vendorId } } });
      if (!current) throw new NotFoundError('التسعيرة غير موجودة.', { rateId });
      const before = await this.zoneOf(tx, vendorId, current.zoneId);

      const switching = patch.method !== undefined && patch.method !== current.method;
      const keep = <T>(sent: T | undefined, old: T, cleared: T): T => (sent !== undefined ? sent : switching ? cleared : old);
      const rate = shape(() =>
        validateRate({
          method: patch.method ?? current.method,
          priceMinor: patch.priceMinor ?? current.priceMinorUnits,
          perKgMinor: keep(patch.perKgMinor, current.perKgMinorUnits, null),
          freeOverMinor: keep(patch.freeOverMinor, current.freeOverMinorUnits, null),
          minDays: patch.minDays ?? current.minDays,
          maxDays: patch.maxDays ?? current.maxDays,
        }),
      );
      await tx.shippingRate.update({
        where: { id: rateId },
        data: { ...rateData(rate), ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}) },
      });
      await this.assertCoherent(tx, vendorId, current.zoneId);
      const out = present(await tx.shippingZone.findUniqueOrThrow({ where: { id: current.zoneId }, include: zoneInclude }));
      await this.audit(tx, userId, 'shipping_rate.update', current.zoneId, present(before), out);
      return out;
    });
  }

  // ------------------------------------------------------------------ داخلي

  private async lockVendor(tx: Tx, vendorId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "vendors" WHERE "id" = ${vendorId}::uuid FOR UPDATE`;
  }

  private async zoneOf(tx: Tx, vendorId: string, zoneId: string): Promise<ZoneRow> {
    const zone = await tx.shippingZone.findFirst({ where: { id: zoneId, vendorId }, include: zoneInclude });
    if (!zone) throw new NotFoundError('المنطقة غير موجودة.', { zoneId });
    return zone;
  }

  /**
   * ما تقرؤه نواة التسعير متّسق للمنطقة المعدَّلة: إن كانت مفعّلة فلها تغطية
   * وتسعيرة مفعّلة، ولا تتعادل تغطيتها مع منطقة مفعّلة أخرى. الفحص مقصور على
   * المنطقة المعدَّلة: بيانات قديمة في منطقة أخرى لا تمنع تعديلاً لا يمسّها.
   */
  private async assertCoherent(tx: Tx, vendorId: string, zoneId: string): Promise<void> {
    const zones = await tx.shippingZone.findMany({ where: { vendorId, isActive: true }, include: zoneInclude });
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return; // موقوفة: لا تُقرأ في التسعير أصلاً

    if (zone.regions.length === 0) {
      throw new InvalidInputError('المنطقة المفعّلة تحتاج بلداً أو مدينة واحدة على الأقل في تغطيتها.', { field: 'regions' });
    }
    if (!zone.rates.some((r) => r.isActive)) {
      throw new ConflictError(
        `منطقة «${zone.nameAr}» مفعّلة بلا تسعيرة مفعّلة — المشترون فيها لن يستطيعوا الشراء منك. أبقِ تسعيرة واحدة مفعّلة على الأقل، أو أوقف المنطقة.`,
        { zoneId },
      );
    }
    const regionsOf = (z: ZoneRow): RegionShape[] => z.regions.map((r) => ({ country: r.country, region: r.region, city: r.city }));
    const tie = findTie(
      regionsOf(zone),
      zones.filter((z) => z.id !== zoneId).map((z) => ({ nameAr: z.nameAr, regions: regionsOf(z) })),
    );
    if (tie) {
      throw new ConflictError(
        `«${describeRegion(tie.region)}» مغطّاة بالدقّة نفسها في منطقة «${tie.zoneName}» المفعّلة — المشتري هناك سيُسعَّر بإحداهما دون ترتيب. احذفها من إحدى المنطقتين، أو أوقف الأخرى.`,
        { zoneName: tie.zoneName, region: tie.region },
      );
    }
  }

  private async audit(tx: Tx, userId: string, action: string, zoneId: string, before: unknown, after: unknown): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        actorRole: 'vendor_owner',
        action,
        entityType: 'ShippingZone',
        entityId: zoneId,
        ...(before ? { beforeJson: before as Prisma.InputJsonValue } : {}),
        ...(after ? { afterJson: after as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
