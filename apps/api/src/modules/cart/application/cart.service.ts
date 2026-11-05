import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { formatIn } from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { settingNumber } from '../../../common/setting-number';
import { DisplayCurrencyService, PricingService, type Quote, type QuoteAddress } from '../../pricing/public';

export const MAX_QTY_PER_LINE = 50;

/** المتاح للبيع الآن: الموجود ناقص المحجوز للدفع — ولا يقلّ عن صفر */
const availableOf = (inv: { onHand: number; reserved: number } | null): number => Math.max(0, (inv?.onHand ?? 0) - (inv?.reserved ?? 0));

export interface CartLineView {
  readonly variantId: string;
  readonly productId: string;
  readonly nameAr: string;
  /** حين يكون الموقع بالإنجليزية — بلا قيمة يُعرض العربي */
  readonly nameEn: string | null;
  readonly variantLabel: string | null;
  readonly imageKey: string | null;
  readonly qty: number;
  readonly available: number;
  /** بعملة السلة — عملة العرض التي يدفع بها المشتري */
  readonly unitPrice: { minorUnits: string; currency: string; formatted: string };
  readonly lineTotal: { minorUnits: string; currency: string; formatted: string };
  /** بعملة المتجر حين تختلف عن عملة السلة — يُعرض تحت المحوَّل */
  readonly originalUnitPrice: { minorUnits: string; currency: string; formatted: string } | null;
  readonly originalLineTotal: { minorUnits: string; currency: string; formatted: string } | null;
  /** السعر تغيّر منذ أُضيف — يُقال للمشتري قبل الدفع لا بعده */
  readonly priceChanged: boolean;
  /** لم يعد يُباع (أُوقف أو أُرشف أو عُلّق متجره): يُعرض ليُزال، ولا يدخل الإجمالي */
  readonly unavailable?: true;
}

export interface CartView {
  readonly token: string;
  readonly currency: string;
  readonly itemCount: number;
  readonly groups: readonly {
    vendorId: string;
    vendorNameAr: string;
    vendorNameEn: string | null;
    /** عملة المتجر — مبالغ المجموعة نفسها بعملة السلة */
    storeCurrency: string;
    lines: readonly CartLineView[];
    subtotal: { minorUnits: string; currency: string; formatted: string };
    shipping: { minorUnits: string; currency: string; formatted: string } | null;
  }[];
  readonly totals: Record<'items' | 'discount' | 'shipping' | 'tax' | 'total', { minorUnits: string; formatted: string }>;
  readonly shippingKnown: boolean;
  readonly taxInclusive: boolean;
  readonly couponCode: string | null;
  /** لماذا لا يُحسب كوبون السلة (استُنفد، انتهى…) — يبقى فيها مانعاً حتى يُزال، و null إن صلح أو لا كوبون */
  readonly couponProblem: string | null;
  readonly blockers: readonly string[];
}

const view = (minor: bigint, currency: string) => ({
  minorUnits: minor.toString(),
  currency,
  formatted: formatIn(minor, currency),
});

/**
 * السلة — ST-13.
 *
 * تُعرَّف برمز عشوائي لا بمعرّف متسلسل: الضيف يحمل رمزه، والرمز الذي
 * يُخمَّن يعني سلة يقرؤها غريب. والسلة **لا تحجز مخزوناً**: الحجز يقع عند
 * بدء الدفع (ADR-006) — حجز كل سلة متروكة يُفرغ المتجر من المتاح.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly display: DisplayCurrencyService,
  ) {}

  /** عملة السلة = عملة العرض التي يدفع بها — من المتاحة للمشتري وحدها */
  private async currencyOf(code: string): Promise<string> {
    const normalized = code.trim().toUpperCase();
    if (!(await this.display.isAvailable(normalized))) throw new InvalidInputError('عملة غير مدعومة.', { currency: code });
    return normalized;
  }

  async create(currency: string, userId: string | null): Promise<CartView> {
    const [hours, code] = await Promise.all([this.expiryHours(), this.currencyOf(currency)]);
    const cart = await this.prisma.cart.create({
      data: {
        sessionToken: randomBytes(24).toString('base64url'),
        currency: code,
        userId,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      },
    });
    return this.view(cart.sessionToken!);
  }

  async addItem(token: string, variantId: string, qty: number, userId: string | null = null): Promise<CartView> {
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new InvalidInputError(`الكمية من 1 إلى ${MAX_QTY_PER_LINE}.`);
    }
    const cart = await this.require(token, userId);
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        archivedAt: null,
        isActive: true,
        product: { status: 'active', deletedAt: null, vendor: { status: 'approved' } },
      },
      select: { id: true, vendorId: true, priceMinorUnits: true, inventory: { select: { onHand: true, reserved: true } } },
    });
    if (!variant) throw new NotFoundError('المنتج غير متاح للبيع.', { variantId });

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    /**
     * الإضافة تحترم المتاح مع ما في السلة — كانت «أضف إلى السلة» 3 بعد 3 تجمع 21 والمتاح 3 بلا كلمة
     * تحت الزرّ، وتقصّ عند 50 بصمت (CHK-013، 5 نوفمبر 2026). السلة تبقى تنبّه قبل الدفع حين ينفد
     * المخزون بعد الإضافة؛ هنا يُقال السبب لحظة الإضافة والسلة كما كانت.
     */
    const inCart = existing?.qty ?? 0;
    const available = availableOf(variant.inventory);
    if (available === 0) throw new InvalidInputError('نفد هذا الخيار من المخزون.', { variantId });
    if (inCart + qty > MAX_QTY_PER_LINE) {
      throw new InvalidInputError(`في سلّتك ${inCart} من هذا الخيار — الحدّ ${MAX_QTY_PER_LINE} قطعة للسطر الواحد.`, { variantId });
    }
    if (inCart + qty > available) {
      if (inCart > 0) throw new InvalidInputError(`في سلّتك ${inCart} من هذا الخيار — المتاح ${available} فقط.`, { variantId });
      throw new InvalidInputError(`المتاح ${available} فقط.`, { variantId });
    }
    const nextQty = inCart + qty;

    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      create: {
        cartId: cart.id,
        variantId,
        vendorId: variant.vendorId,
        qty: nextQty,
        priceMinorUnitsAtAdd: variant.priceMinorUnits,
      },
      update: { qty: nextQty },
    });
    return this.view(token);
  }

  async setQty(token: string, variantId: string, qty: number, userId: string | null = null): Promise<CartView> {
    const cart = await this.require(token, userId);
    if (qty === 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
      return this.view(token);
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new InvalidInputError(`الكمية من 1 إلى ${MAX_QTY_PER_LINE}.`);
    }
    const line = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      select: { qty: true, variant: { select: { inventory: { select: { onHand: true, reserved: true } } } } },
    });
    if (!line) throw new NotFoundError('المنتج ليس في سلّتك.', { variantId });
    // الرفع فوق المتاح يُرفض، والإنقاص يمرّ ولو بقي فوقه: نفد بعد الإضافة فينقصه صاحبه خطوة خطوة (CHK-013)
    const available = availableOf(line.variant.inventory);
    if (qty > line.qty && qty > available) throw new InvalidInputError(`المتاح ${available} فقط.`, { variantId });
    const { count } = await this.prisma.cartItem.updateMany({
      where: { cartId: cart.id, variantId },
      data: { qty },
    });
    if (count === 0) throw new NotFoundError('المنتج ليس في سلّتك.', { variantId });
    return this.view(token);
  }

  async setCoupon(token: string, code: string | null, userId: string | null = null): Promise<CartView> {
    const cart = await this.require(token, userId);
    const normalized = code?.trim().toUpperCase() || null;
    if (normalized) {
      // يُتحقّق الآن فيسمع المشتري السبب عند الإدخال لا عند الدفع
      await this.quoteFor(cart.id, cart.currency, null, normalized, cart.userId);
    }
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: normalized } });
    return this.view(token);
  }

  async setCurrency(token: string, currency: string, userId: string | null = null): Promise<CartView> {
    const [cart, code] = await Promise.all([this.require(token, userId), this.currencyOf(currency)]);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { currency: code } });
    return this.view(token);
  }

  /** سطور السلة كما هي — للدفع */
  async lines(token: string, userId: string | null = null): Promise<{
    cartId: string;
    currency: string;
    couponCode: string | null;
    userId: string | null;
    items: { variantId: string; qty: number }[];
  }> {
    const cart = await this.require(token, userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      select: { variantId: true, qty: true },
      orderBy: { addedAt: 'asc' },
    });
    return { cartId: cart.id, currency: cart.currency, couponCode: cart.couponCode, userId: cart.userId, items };
  }

  async clear(cartId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
    await this.prisma.cart.update({ where: { id: cartId }, data: { couponCode: null } });
  }

  /**
   * يطرح ما دُفع ثمنه من سلته — لنجاح وصل متأخراً، والسلة ربما تغيّرت بعد الطلب: ما أضافه المشتري
   * بعده يبقى، وما دفعه لا يبقى ليدفعه مرة ثانية. الكوبون يُمحى إن فرغت كما يُمحى مع clear.
   */
  async removeBought(cartId: string, bought: readonly { variantId: string; qty: number }[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const { variantId, qty } of bought) {
        const { count } = await tx.cartItem.updateMany({ where: { cartId, variantId, qty: { gt: qty } }, data: { qty: { decrement: qty } } });
        if (count === 0) await tx.cartItem.deleteMany({ where: { cartId, variantId } });
      }
      if ((await tx.cartItem.count({ where: { cartId } })) === 0) {
        await tx.cart.update({ where: { id: cartId }, data: { couponCode: null } });
      }
    });
  }

  async view(token: string, address: QuoteAddress | null = null, userId: string | null = null): Promise<CartView> {
    const cart = await this.require(token, userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { addedAt: 'asc' },
    });

    if (items.length === 0) {
      const zero = { minorUnits: '0', formatted: formatIn(0n, cart.currency) };
      return {
        token,
        currency: cart.currency,
        itemCount: 0,
        groups: [],
        totals: { items: zero, discount: zero, shipping: zero, tax: zero, total: zero },
        shippingKnown: false,
        taxInclusive: true,
        couponCode: cart.couponCode,
        couponProblem: null,
        blockers: [],
      };
    }

    /**
     * قطعة لم تعد تُباع (أوقفتها الإدارة، أو أرشفها البائع، أو عُلّق متجره) كانت تُسقط التسعير
     * كله بـ 404، فيقرؤه المتصفّح سلة انتهت ويمحو رمزها — وتضيع معها قطع المتاجر الأخرى
     * (CHK-021 — حدث في J-10، 20 أكتوبر 2026). الآن تُسعَّر السلة بلا الغائبة، وتُعرض هي
     * سطراً «لم يعد متاحاً» يُزال، ومانعاً يوقف الدفع حتى يُزال.
     */
    let gone: string[] = [];
    let quote: Quote | null = null;
    /**
     * كوبون صار لا يصلح منذ أُضيف (استُنفد، انتهى، استعمله صاحبه): تُسعَّر السلة بدونه ويبقى فيها
     * بسببه مانعاً حتى يُزال. كان يُمحى منها بصمت، فيرى المشتري الإجمالي كاملاً بلا كلمة — وأيقونة
     * السلة في الرأس تقرؤها قبل صفحتها، فلا يصل سببٌ يُقال مرة (بطلب صاحبة المشروع، 4 نوفمبر 2026)
     */
    let couponProblem: string | null = null;
    for (;;) {
      const rest = items.filter((i) => !gone.includes(i.variantId));
      if (rest.length === 0) break;
      try {
        quote = await this.pricing.quote({
          items: rest.map((i) => ({ variantId: i.variantId, qty: i.qty })),
          currency: cart.currency,
          address,
          couponCode: couponProblem === null ? cart.couponCode : null,
          userId: cart.userId,
        });
        break;
      } catch (err) {
        // يُعاد التسعير بلا الكوبون: إن سقط ثانيةً فالعلّة في غيره، وتُرمى كما هي
        if (cart.couponCode && couponProblem === null && err instanceof InvalidInputError) {
          couponProblem = err.message;
          continue;
        }
        const missing = err instanceof NotFoundError ? err.details?.['variantIds'] : undefined;
        if (!Array.isArray(missing) || missing.length === 0) throw err;
        gone = [...gone, ...(missing as string[])];
      }
    }

    const atAdd = new Map(items.map((i) => [i.variantId, i.priceMinorUnitsAtAdd]));
    const blockers = [...(quote?.blockers ?? [])];
    if (couponProblem !== null) blockers.push(`الكوبون ${cart.couponCode} لم يعد صالحاً — ${couponProblem} أزله من سلّتك لتكمل الطلب.`);
    const zero = view(0n, cart.currency);

    /**
     * كل مبلغ بعملة السلة (18 أكتوبر 2026). سعر القطعة محوَّلاً بمعامل المتجر كما في
     * صفحة المنتج، والسطر = القطعة × الكمية، ومجموع الأسطر = مجموع المتجر = ما يدخل
     * الإجمالي بالضبط — من التسعير نفسه (CHK-014، 27 أكتوبر 2026).
     */
    const priced = quote;
    const groups: CartView['groups'][number][] = (priced?.subOrders ?? []).map((s) => {
      const converted = s.currency !== cart.currency;
      return {
        vendorId: s.vendorId,
        vendorNameAr: s.vendorNameAr,
        vendorNameEn: s.vendorNameEn ?? null,
        storeCurrency: s.currency,
        lines: s.lines.map((l) => {
          const available = priced!.availability.get(l.variantId) ?? 0;
          if (available < l.qty) {
            blockers.push(
              available === 0
                ? `${l.nameAr} نفد. احذفه من سلّتك.`
                : `${l.nameAr}: المتاح ${available} فقط.`,
            );
          }
          return {
            variantId: l.variantId,
            productId: l.productId,
            nameAr: l.nameAr,
            nameEn: l.nameEn ?? null,
            variantLabel: l.variantLabel,
            imageKey: l.imageKey,
            qty: l.qty,
            available,
            unitPrice: view(l.chargeUnitMinor, cart.currency),
            lineTotal: view(l.chargeSubtotal, cart.currency),
            originalUnitPrice: converted ? view(l.unitPriceMinor, s.currency) : null,
            originalLineTotal: converted ? view(l.lineSubtotal, s.currency) : null,
            priceChanged: atAdd.get(l.variantId) !== l.unitPriceMinor,
          };
        }),
        subtotal: view(s.charge.items, cart.currency),
        shipping: priced!.shippingKnown ? view(s.charge.shipping, cart.currency) : null,
      };
    });

    // ما لم يعد يُباع: في مجموعة متجره (أو مجموعة له وحده)، بلا سعر يدخل الإجمالي
    if (gone.length > 0) {
      const rows = await this.prisma.productVariant.findMany({
        where: { id: { in: gone } },
        select: {
          id: true,
          productId: true,
          product: {
            select: {
              nameAr: true,
              nameEn: true,
              images: { orderBy: { sort: 'asc' }, take: 1, select: { fileKey: true } },
              vendor: { select: { id: true, nameAr: true, nameEn: true, settlementCurrency: true } },
            },
          },
          optionValues: { select: { attributeValue: { select: { valueAr: true } } } },
        },
      });
      for (const r of rows) {
        const item = items.find((i) => i.variantId === r.id)!;
        blockers.push(`${r.product.nameAr} لم يعد متاحاً للبيع. احذفه من سلّتك.`);
        const line: CartLineView = {
          variantId: r.id,
          productId: r.productId,
          nameAr: r.product.nameAr,
          nameEn: r.product.nameEn,
          variantLabel: r.optionValues.map((o) => o.attributeValue.valueAr).join(' / ') || null,
          imageKey: r.product.images[0]?.fileKey ?? null,
          qty: item.qty,
          available: 0,
          unitPrice: zero,
          lineTotal: zero,
          originalUnitPrice: null,
          originalLineTotal: null,
          priceChanged: false,
          unavailable: true,
        };
        const vendor = r.product.vendor;
        const at = groups.findIndex((g) => g.vendorId === vendor.id);
        if (at >= 0) groups[at] = { ...groups[at]!, lines: [...groups[at]!.lines, line] };
        else groups.push({ vendorId: vendor.id, vendorNameAr: vendor.nameAr, vendorNameEn: vendor.nameEn, storeCurrency: vendor.settlementCurrency, lines: [line], subtotal: zero, shipping: null });
      }
    }

    const totalView = (minor: bigint) => ({ minorUnits: minor.toString(), formatted: formatIn(minor, cart.currency) });

    return {
      token,
      currency: cart.currency,
      itemCount: items.reduce((a, i) => a + i.qty, 0),
      groups,
      totals: {
        items: totalView(priced?.totals.items ?? 0n),
        discount: totalView(priced?.totals.discount ?? 0n),
        shipping: totalView(priced?.totals.shipping ?? 0n),
        tax: totalView(priced?.totals.tax ?? 0n),
        total: totalView(priced?.totals.total ?? 0n),
      },
      shippingKnown: priced?.shippingKnown ?? false,
      taxInclusive: priced?.taxInclusive ?? true,
      couponCode: priced?.coupon?.code ?? cart.couponCode,
      couponProblem,
      blockers,
    };
  }

  private quoteFor(
    cartId: string,
    currency: string,
    address: QuoteAddress | null,
    couponCode: string | null,
    userId: string | null,
  ): Promise<Quote> {
    return this.prisma.cartItem
      .findMany({ where: { cartId }, select: { variantId: true, qty: true } })
      .then((items) => this.pricing.quote({ items, currency, address, couponCode, userId }));
  }

  /**
   * سلة الحساب لا يفتحها حساب آخر (CHK-020، 27 أكتوبر 2026): رمز بقي في متصفّح مشترك كان
   * يُظهر سلّة من خرج لمن يدخل بعده ويدعه يدفعها. تُردّ كأنها غير موجودة فتبدأ الواجهة سلة
   * جديدة له. وسلة الضيف تصير لأول حساب يفتحها — فتُحرس هي أيضاً بعد دخوله.
   */
  private async require(token: string, userId: string | null = null) {
    const cart = await this.prisma.cart.findUnique({ where: { sessionToken: token } });
    if (!cart || cart.expiresAt < new Date()) throw new NotFoundError('السلة غير موجودة أو انتهت.', { resource: 'cart' });
    if (userId && cart.userId && cart.userId !== userId) throw new NotFoundError('السلة غير موجودة أو انتهت.', { resource: 'cart' });
    if (userId && !cart.userId) return this.prisma.cart.update({ where: { id: cart.id }, data: { userId } });
    return cart;
  }

  private async expiryHours(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'cart_expiry_hours' } });
    // نصٌّ تالف في القاعدة كان NaN فيفشل إنشاء كل سلة وتمديدها (2 نوفمبر 2026)
    return settingNumber(row?.valueJson, 168, 1);
  }
}
