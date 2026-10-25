import { Injectable } from '@nestjs/common';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { minorUnitDigits } from '../../../common/money/money';
import { samePlace } from '../../../common/places';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InventoryService } from '../../inventory/public';
import { DisplayCurrencyService } from './display-currency.service';
import {
  priceCart,
  quoteShipping,
  type CouponInput,
  type PricedCart,
  type PricedLineInput,
  type ShippingQuote,
  type VendorContext,
} from '../domain/pricing';

export interface QuoteAddress {
  readonly country: string;
  readonly region: string | null;
  readonly city: string | null;
}

export interface QuoteInput {
  readonly items: readonly { variantId: string; qty: number }[];
  readonly currency: string;
  /** بلا عنوان: الشحن والضريبة غير معروفين بعد — السلة تعرض البنود وحدها */
  readonly address: QuoteAddress | null;
  readonly couponCode: string | null;
  readonly userId?: string | null | undefined;
  readonly now?: Date;
}

export interface Quote extends PricedCart {
  readonly shippingKnown: boolean;
  /** توفّر كل سطر لحظة التسعير — المانع الحقيقي يقع عند الحجز لا هنا */
  readonly availability: ReadonlyMap<string, number>;
}

/**
 * يحمّل كل ما يحتاجه التسعير ويمرّره للنواة الصافية.
 *
 * **كل سعر يُقرأ من القاعدة الآن**، لا من السلة: `priceMinorUnitsAtAdd` في
 * السلة للمقارنة («تغيّر السعر منذ أضفته») لا للدفع. المشتري يدفع سعر لحظة
 * الطلب، وهو ما يراه في المراجعة.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly display: DisplayCurrencyService,
  ) {}

  async quote(input: QuoteInput): Promise<Quote> {
    const currency = input.currency.toUpperCase();
    minorUnitDigits(currency); // يرمي إن كانت العملة مجهولة

    const merged = new Map<string, number>();
    for (const i of input.items) merged.set(i.variantId, (merged.get(i.variantId) ?? 0) + i.qty);

    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: [...merged.keys()] },
        archivedAt: null,
        isActive: true,
        // قاعدة الرؤية نفسها في المتجر: ما لا يُعرض لا يُباع
        product: { status: 'active', deletedAt: null, vendor: { status: 'approved' } },
      },
      include: {
        product: {
          select: {
            id: true,
            nameAr: true,
            vendorId: true,
            // كل الصور (عشر على الأكثر) لا الأولى: صورة اللون المختار تسبق الرئيسية في السلة والطلب
            images: { orderBy: { sort: 'asc' }, select: { fileKey: true, variantId: true, optionValueId: true } },
          },
        },
        optionValues: { include: { attributeValue: { select: { valueAr: true } } } },
      },
    });

    const missing = [...merged.keys()].filter((id) => !variants.some((v) => v.id === id));
    if (missing.length > 0) {
      throw new NotFoundError('منتج في سلّتك لم يعد متاحاً للبيع. احذفه ثم تابع.', { variantIds: missing });
    }

    const vendorIds = [...new Set(variants.map((v) => v.vendorId))];
    const [vendorRows, rates, settings, levels, commissions] = await Promise.all([
      this.prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, nameAr: true, settlementCurrency: true },
      }),
      // المصدر نفسه الذي يُعرض منه السعر في المتجر — ما يُرى هو ما يُخصم
      this.display.usdRates(input.now ?? new Date()),
      this.settings(['fx_spread_bps', 'default_commission_bps']),
      this.inventory.levels([...merged.keys()]),
      this.commissionRules(vendorIds, input.now ?? new Date()),
    ]);

    const vendors = new Map<string, VendorContext>(
      vendorRows.map((v) => [
        v.id,
        {
          vendorId: v.id,
          nameAr: v.nameAr,
          currency: v.settlementCurrency,
          currencyDigits: minorUnitDigits(v.settlementCurrency),
        },
      ]),
    );

    const defaultBps = Number(settings.get('default_commission_bps') ?? 1000);
    const lines: PricedLineInput[] = variants.map((v) => ({
      variantId: v.id,
      productId: v.product.id,
      vendorId: v.vendorId,
      nameAr: v.product.nameAr,
      variantLabel: v.optionValues.map((o) => o.attributeValue.valueAr).join(' / ') || null,
      sku: v.sku,
      imageKey: imageFor(v)?.fileKey ?? null,
      unitPriceMinor: v.priceMinorUnits,
      qty: merged.get(v.id) ?? 0,
      weightGrams: v.weightGrams,
      commissionBps: commissions(v.vendorId) ?? defaultBps,
    }));

    const shipping = new Map<string, ShippingQuote>();
    for (const vendorId of vendorIds) {
      const vendor = vendors.get(vendorId)!;
      if (!input.address) {
        shipping.set(vendorId, { available: true, minor: 0n, minDays: 0, maxDays: 0 });
        continue;
      }
      const own = lines.filter((l) => l.vendorId === vendorId);
      shipping.set(
        vendorId,
        await this.shippingQuote(vendorId, input.address, {
          itemsMinor: own.reduce((a, l) => a + l.unitPriceMinor * BigInt(l.qty), 0n),
          weightGrams: own.reduce((a, l) => a + (l.weightGrams ?? 0) * l.qty, 0),
          vendorNameAr: vendor.nameAr,
        }),
      );
    }

    const tax = input.address ? await this.taxFor(input.address, input.now ?? new Date()) : { rateBps: 0, inclusive: true };
    const coupon = input.couponCode
      ? await this.coupon(input.couponCode, input.userId ?? null, input.now ?? new Date())
      : null;

    const priced = priceCart({
      lines,
      vendors,
      shipping,
      coupon,
      tax,
      fx: {
        orderCurrency: currency,
        orderDigits: minorUnitDigits(currency),
        usdRates: rates,
        spreadBps: Number(settings.get('fx_spread_bps') ?? 200),
      },
    });

    return {
      ...priced,
      shippingKnown: input.address !== null,
      availability: new Map(levels.map((l) => [l.variantId, l.available])),
    };
  }

  // ------------------------------------------------------------- المصادر

  private async settings(keys: readonly string[]): Promise<Map<string, unknown>> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [...keys] } } });
    return new Map(rows.map((r) => [r.key, r.valueJson as unknown]));
  }

  /**
   * نسبة العمولة على كل منتج يُباع: نسبة المتجر إن خُصّصت، وإلا العامة — بغضّ
   * النظر عن فئته أو سعره (قرار صاحب المشروع 14 أكتوبر 2026، ألغى مستوى الفئة).
   * تُلقط على السطر الآن وتُقرأ اللقطة في كل احتساب لاحق — ADR-004.
   */
  private async commissionRules(vendorIds: readonly string[], at: Date): Promise<(vendorId: string) => number | null> {
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        scope: { in: ['vendor', 'global'] },
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        AND: [{ OR: [{ vendorId: { in: [...vendorIds] } }, { vendorId: null }] }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    return (vendorId) => {
      const vendorRule = rules.find((r) => r.scope === 'vendor' && r.vendorId === vendorId);
      if (vendorRule) return vendorRule.rateBps;
      return rules.find((r) => r.scope === 'global')?.rateBps ?? null;
    };
  }

  private async shippingQuote(
    vendorId: string,
    address: QuoteAddress,
    ctx: { itemsMinor: bigint; weightGrams: number; vendorNameAr: string },
  ): Promise<ShippingQuote> {
    const zones = await this.prisma.shippingZone.findMany({
      where: { vendorId, isActive: true },
      include: { regions: true, rates: true },
    });
    return quoteShipping(
      zones.map((z) => ({
        regions: z.regions.map((r) => ({ country: r.country, region: r.region, city: r.city })),
        rates: z.rates.map((r) => ({
          method: r.method,
          priceMinor: r.priceMinorUnits,
          perKgMinor: r.perKgMinorUnits,
          freeOverMinor: r.freeOverMinorUnits,
          minDays: r.minDays,
          maxDays: r.maxDays,
          isActive: r.isActive,
        })),
      })),
      address,
      ctx,
    );
  }

  /** الضريبة تتبع بلد المشتري لا عملته — ADR-013، Q-04 */
  private async taxFor(address: QuoteAddress, at: Date): Promise<{ rateBps: number; inclusive: boolean }> {
    const rows = await this.prisma.taxRate.findMany({
      where: {
        country: address.country.toUpperCase(),
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const regional = rows.find((r) => r.region && samePlace(r.region, address.region));
    const national = rows.find((r) => !r.region);
    const rate = regional ?? national;
    return rate ? { rateBps: rate.rateBps, inclusive: rate.isPriceInclusive } : { rateBps: 0, inclusive: true };
  }

  private async coupon(code: string, userId: string | null, at: Date): Promise<CouponInput> {
    const c = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    const invalid = (message: string): never => {
      throw new InvalidInputError(message, { code });
    };
    if (!c || !c.isActive) return invalid('الكوبون غير صالح.');
    if (c.startsAt && c.startsAt > at) return invalid('الكوبون لم يبدأ بعد.');
    if (c.endsAt && c.endsAt <= at) return invalid('انتهت صلاحية الكوبون.');
    if (c.usageLimitTotal !== null && c.usedCount >= c.usageLimitTotal) {
      return invalid('استُنفد الكوبون.');
    }
    if (userId && c.usageLimitPerUser !== null) {
      const used = await this.prisma.couponRedemption.count({ where: { couponId: c.id, userId } });
      if (used >= c.usageLimitPerUser) return invalid('استعملت هذا الكوبون من قبل.');
    }
    // المنصّي الثابت يُطبَّق على بائعي عملته وحدهم، خصماً واحداً للطلب (spreadFixed) — كان يُرفض هنا
    // دائماً، فلا يُستعمل كوبون «مبلغ ثابت» تنشئه اللوحة أبداً (ACFG-035)
    return {
      code: c.code,
      scope: c.scope as 'platform' | 'vendor',
      vendorId: c.vendorId,
      type: c.type as CouponInput['type'],
      valueBps: c.valueBps,
      valueMinor: c.valueMinorUnits,
      maxDiscountMinor: c.maxDiscountMinorUnits,
      minOrderMinor: c.minOrderMinorUnits,
      currency: c.currency,
      currencyDigits: c.currency
        ? ((await this.prisma.currency.findUnique({ where: { code: c.currency }, select: { minorUnitDigits: true } }))
            ?.minorUnitDigits ?? null)
        : null,
      fundedBy: c.fundedBy as 'platform' | 'vendor',
    };
  }
}

/**
 * صورة السطر في السلة والطلب: صورة المتغيّر بعينه، ثم صورة إحدى قيمه (اللون الأحمر)، ثم
 * الرئيسية. من اشترى الأزرق يرى الأزرق في طلبه لا صورة الغلاف الحمراء.
 */
export function imageFor(v: {
  id: string;
  optionValues: readonly { attributeValueId: string }[];
  product: { images: readonly { fileKey: string; variantId: string | null; optionValueId: string | null }[] };
}): { fileKey: string } | undefined {
  const values = new Set(v.optionValues.map((o) => o.attributeValueId));
  const images = v.product.images;
  return (
    images.find((i) => i.variantId === v.id) ??
    images.find((i) => i.optionValueId !== null && values.has(i.optionValueId)) ??
    images[0]
  );
}
