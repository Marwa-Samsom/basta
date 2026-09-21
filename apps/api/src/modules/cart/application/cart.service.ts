import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { format, money } from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PricingService, type Quote, type QuoteAddress } from '../../pricing/public';

export const MAX_QTY_PER_LINE = 50;

export interface CartLineView {
  readonly variantId: string;
  readonly productId: string;
  readonly nameAr: string;
  readonly variantLabel: string | null;
  readonly imageKey: string | null;
  readonly qty: number;
  readonly available: number;
  readonly unitPrice: { minorUnits: string; currency: string; formatted: string };
  readonly lineTotal: { minorUnits: string; currency: string; formatted: string };
  /** السعر تغيّر منذ أُضيف — يُقال للمشتري قبل الدفع لا بعده */
  readonly priceChanged: boolean;
}

export interface CartView {
  readonly token: string;
  readonly currency: string;
  readonly itemCount: number;
  readonly groups: readonly {
    vendorId: string;
    vendorNameAr: string;
    lines: readonly CartLineView[];
    subtotal: { minorUnits: string; currency: string; formatted: string };
    shipping: { minorUnits: string; currency: string; formatted: string } | null;
  }[];
  readonly totals: Record<'items' | 'discount' | 'shipping' | 'tax' | 'total', { minorUnits: string; formatted: string }>;
  readonly shippingKnown: boolean;
  readonly taxInclusive: boolean;
  readonly couponCode: string | null;
  readonly blockers: readonly string[];
}

const view = (minor: bigint, currency: string) => ({
  minorUnits: minor.toString(),
  currency,
  formatted: format(money(minor, currency)),
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
  ) {}

  async create(currency: string, userId: string | null): Promise<CartView> {
    const hours = await this.expiryHours();
    const cart = await this.prisma.cart.create({
      data: {
        sessionToken: randomBytes(24).toString('base64url'),
        currency: currency.toUpperCase(),
        userId,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      },
    });
    return this.view(cart.sessionToken!);
  }

  async addItem(token: string, variantId: string, qty: number): Promise<CartView> {
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new InvalidInputError(`الكمية من 1 إلى ${MAX_QTY_PER_LINE}.`);
    }
    const cart = await this.require(token);
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        archivedAt: null,
        isActive: true,
        product: { status: 'active', deletedAt: null, vendor: { status: 'approved' } },
      },
      select: { id: true, vendorId: true, priceMinorUnits: true },
    });
    if (!variant) throw new NotFoundError('المنتج غير متاح للبيع.', { variantId });

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    const nextQty = Math.min((existing?.qty ?? 0) + qty, MAX_QTY_PER_LINE);

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

  async setQty(token: string, variantId: string, qty: number): Promise<CartView> {
    const cart = await this.require(token);
    if (qty === 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
      return this.view(token);
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new InvalidInputError(`الكمية من 1 إلى ${MAX_QTY_PER_LINE}.`);
    }
    const { count } = await this.prisma.cartItem.updateMany({
      where: { cartId: cart.id, variantId },
      data: { qty },
    });
    if (count === 0) throw new NotFoundError('المنتج ليس في سلّتك.', { variantId });
    return this.view(token);
  }

  async setCoupon(token: string, code: string | null): Promise<CartView> {
    const cart = await this.require(token);
    const normalized = code?.trim().toUpperCase() || null;
    if (normalized) {
      // يُتحقّق الآن فيسمع المشتري السبب عند الإدخال لا عند الدفع
      await this.quoteFor(cart.id, cart.currency, null, normalized, cart.userId);
    }
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: normalized } });
    return this.view(token);
  }

  async setCurrency(token: string, currency: string): Promise<CartView> {
    const cart = await this.require(token);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { currency: currency.toUpperCase() } });
    return this.view(token);
  }

  /** سطور السلة كما هي — للدفع */
  async lines(token: string): Promise<{
    cartId: string;
    currency: string;
    couponCode: string | null;
    userId: string | null;
    items: { variantId: string; qty: number }[];
  }> {
    const cart = await this.require(token);
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

  async view(token: string, address: QuoteAddress | null = null): Promise<CartView> {
    const cart = await this.require(token);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { addedAt: 'asc' },
    });

    if (items.length === 0) {
      const zero = { minorUnits: '0', formatted: format(money(0n, cart.currency)) };
      return {
        token,
        currency: cart.currency,
        itemCount: 0,
        groups: [],
        totals: { items: zero, discount: zero, shipping: zero, tax: zero, total: zero },
        shippingKnown: false,
        taxInclusive: true,
        couponCode: cart.couponCode,
        blockers: [],
      };
    }

    let quote: Quote;
    try {
      quote = await this.quoteFor(cart.id, cart.currency, address, cart.couponCode, cart.userId);
    } catch (err) {
      // كوبون انتهى منذ أُضيف: يسقط ويُقال السبب، ولا تتعطّل السلة كلها
      if (cart.couponCode && err instanceof InvalidInputError) {
        await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
        return this.view(token, address);
      }
      throw err;
    }

    const atAdd = new Map(items.map((i) => [i.variantId, i.priceMinorUnitsAtAdd]));
    const blockers = [...quote.blockers];

    const groups = quote.subOrders.map((s) => ({
      vendorId: s.vendorId,
      vendorNameAr: s.vendorNameAr,
      lines: s.lines.map((l) => {
        const available = quote.availability.get(l.variantId) ?? 0;
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
          variantLabel: l.variantLabel,
          imageKey: l.imageKey,
          qty: l.qty,
          available,
          unitPrice: view(l.unitPriceMinor, s.currency),
          lineTotal: view(l.lineSubtotal, s.currency),
          priceChanged: atAdd.get(l.variantId) !== l.unitPriceMinor,
        };
      }),
      subtotal: view(s.vendor.items, s.currency),
      shipping: quote.shippingKnown ? view(s.vendor.shipping, s.currency) : null,
    }));

    const totalView = (minor: bigint) => ({ minorUnits: minor.toString(), formatted: format(money(minor, cart.currency)) });

    return {
      token,
      currency: cart.currency,
      itemCount: items.reduce((a, i) => a + i.qty, 0),
      groups,
      totals: {
        items: totalView(quote.totals.items),
        discount: totalView(quote.totals.discount),
        shipping: totalView(quote.totals.shipping),
        tax: totalView(quote.totals.tax),
        total: totalView(quote.totals.total),
      },
      shippingKnown: quote.shippingKnown,
      taxInclusive: quote.taxInclusive,
      couponCode: quote.coupon?.code ?? null,
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

  private async require(token: string) {
    const cart = await this.prisma.cart.findUnique({ where: { sessionToken: token } });
    if (!cart || cart.expiresAt < new Date()) throw new NotFoundError('السلة غير موجودة أو انتهت.', {});
    return cart;
  }

  private async expiryHours(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'cart_expiry_hours' } });
    return Number(row?.valueJson ?? 168);
  }
}
