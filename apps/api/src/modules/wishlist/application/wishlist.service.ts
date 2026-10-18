import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error';
import { format, money } from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InventoryService } from '../../inventory/public';
import { DisplayCurrencyService, type DisplayFx } from '../../pricing/public';

/** سقف القائمة لكل مستخدم — يمنع الإغراق ولا يضيّق على أحد */
export const MAX_WISHLIST = 200;

/** «بقي N فقط» عند هذا العدد أو أقل — الحدّ نفسه في صفحة المنتج وبطاقته */
export const WISHLIST_LOW_STOCK = 3;

/**
 * حالة المحفوظ الآن، بالأولوية: ما لا يُشترى أولاً، ثم ما تغيّر سعره، ثم ما قارب النفاد.
 * `unavailable`: المنتج لم يعد معروضاً (أُرشف أو سُحب أو عُلّق بائعه) — يبقى في
 * القائمة بحالته ولا يختفي بصمت؛ صاحبه يقرّر إزالته.
 */
export type WishlistState = 'unavailable' | 'sold_out' | 'drop' | 'rise' | 'low' | 'ok';

export interface WishlistMoney {
  readonly minorUnits: string;
  readonly currency: string;
  /** للعرض فقط — الحساب على minorUnits (ADR-001) */
  readonly formatted: string;
}

export interface WishlistItemView {
  readonly productId: string;
  readonly slug: string;
  readonly nameAr: string;
  /** مقاس بطاقة المنتج نفسه (thumb) — مسار على خادم الرفع */
  readonly image: string | null;
  readonly shop: { readonly slug: string; readonly nameAr: string };
  readonly savedPrice: WishlistMoney;
  /** أرخص متغيّر نشط الآن؛ `null` حين لم يعد المنتج معروضاً */
  readonly currentPrice: WishlistMoney | null;
  /** الفرق المطلق بين الآن ولحظة الحفظ، حين يكون للمقارنة معنى (العملة نفسها) */
  readonly delta: WishlistMoney | null;
  readonly state: WishlistState;
  /** المتاح عبر المتغيّرات النشطة كلها */
  readonly available: number;
  /** أكثر من متغيّر نشط: «انقله إلى السلة» يحتاج اختياراً في صفحة المنتج */
  readonly hasVariants: boolean;
  /** المتغيّر الوحيد حين لا خيارات — يُضاف إلى السلة مباشرةً */
  readonly variantId: string | null;
  readonly savedAt: string;
}

export interface WishlistView {
  readonly items: readonly WishlistItemView[];
  readonly count: number;
  readonly max: number;
}

const view = (minor: bigint, currency: string): WishlistMoney => ({
  minorUnits: minor.toString(),
  currency,
  formatted: format(money(minor, currency)),
});

/** بعملة العرض، أو بعملته إن تعذّر الصرف — المقارنة تبقى بعملة المتجر */
const shown = (fx: DisplayFx, minor: bigint, currency: string): WishlistMoney => {
  const converted = fx.convert(minor, currency);
  return converted === null ? view(minor, currency) : view(converted, fx.currency);
};

const ACTIVE_VARIANT = { archivedAt: null, isActive: true } as const satisfies Prisma.ProductVariantWhereInput;

/**
 * قاعدة رؤية المتجر نفسها (catalog/storefront.service): منشور، غير محذوف،
 * بائعه معتمد، وله متغيّر نشط. لا يُحفظ ما لا يراه المشتري في المتجر.
 */
const VISIBLE = {
  status: 'active',
  deletedAt: null,
  vendor: { status: 'approved' },
  variants: { some: ACTIVE_VARIANT },
} as const satisfies Prisma.ProductWhereInput;

const NOT_FOUND = 'المنتج غير موجود أو لم يعد معروضاً.';

/**
 * ST-23 — المفضّلة.
 *
 * **كل استعلام يحمل `userId` الفاعل** — لا دالة تقرأ أو تحذف محفوظاً بمعرّف
 * المنتج وحده. الإضافة عديمة الأثر عند التكرار ولا تكتب فوق السعر المحفوظ:
 * «انخفض 13.00 منذ حفظه» يقيس من لحظة الحفظ الأولى لا من آخر ضغطة على القلب.
 *
 * السقف يُفرض تحت قفل صف المستخدم `FOR NO KEY UPDATE` (النمط نفسه في دفتر
 * العناوين): إضافتان متزامنتان عند 199 لا تتجاوزان 200.
 */
@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly display: DisplayCurrencyService,
  ) {}

  async add(userId: string, productId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId);

      const product = await tx.product.findFirst({
        where: { id: productId, ...VISIBLE },
        select: {
          vendor: { select: { settlementCurrency: true } },
          variants: {
            where: ACTIVE_VARIANT,
            orderBy: { priceMinorUnits: 'asc' },
            take: 1,
            select: { priceMinorUnits: true },
          },
        },
      });
      const cheapest = product?.variants[0];
      if (!product || !cheapest) throw new NotFoundError(NOT_FOUND, { productId });

      const existing = await tx.wishlistItem.findUnique({
        where: { userId_productId: { userId, productId } },
        select: { productId: true },
      });
      if (existing) return; // محفوظ من قبل — السعر المحفوظ يبقى كما كان

      const count = await tx.wishlistItem.count({ where: { userId } });
      if (count >= MAX_WISHLIST) {
        throw new ConflictError(
          `بلغت مفضّلتك ${MAX_WISHLIST} منتج. أزل منتجاً لم تعد تريده ثم احفظ الجديد.`,
          { max: MAX_WISHLIST },
        );
      }

      await tx.wishlistItem.create({
        data: {
          userId,
          productId,
          savedPriceMinorUnits: cheapest.priceMinorUnits,
          currency: product.vendor.settlementCurrency,
        },
      });
    });
  }

  /** عديم الأثر: إزالة ما ليس محفوظاً — أو محفوظ غيرك — لا تفعل شيئاً ولا تكشف شيئاً */
  async remove(userId: string, productId: string): Promise<void> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  }

  /** معرّفات المحفوظ وحدها — لحالة القلوب في صفحة كاملة باستدعاء واحد */
  async ids(userId: string): Promise<string[]> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  /**
   * الأسعار بعملة العرض (18 أكتوبر 2026). «انخفض» و«ارتفع» يُقاسان بعملة المتجر
   * كما سعّر البائع، لا بعد الصرف: تغيّر سعر الصرف ليس تخفيضاً من المتجر.
   */
  async list(userId: string, displayCurrency?: string): Promise<WishlistView> {
    const fx = await this.display.resolve(displayCurrency);
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { productId: 'asc' }],
      select: {
        savedPriceMinorUnits: true,
        currency: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            slug: true,
            nameAr: true,
            status: true,
            deletedAt: true,
            vendor: { select: { slug: true, nameAr: true, status: true, settlementCurrency: true } },
            variants: {
              where: ACTIVE_VARIANT,
              orderBy: { priceMinorUnits: 'asc' },
              select: { id: true, priceMinorUnits: true },
            },
            images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } },
          },
        },
      },
    });

    const levels = new Map(
      (await this.inventory.levels(rows.flatMap((r) => r.product.variants.map((v) => v.id)))).map((l) => [
        l.variantId,
        l.available,
      ]),
    );

    const items = rows.map((r): WishlistItemView => {
      const p = r.product;
      const saved = shown(fx, r.savedPriceMinorUnits, r.currency);
      const cheapest = p.variants[0];
      const visible =
        p.status === 'active' && p.deletedAt === null && p.vendor.status === 'approved' && cheapest !== undefined;
      const available = visible ? p.variants.reduce((sum, v) => sum + Math.max(0, levels.get(v.id) ?? 0), 0) : 0;
      const currency = p.vendor.settlementCurrency;

      const base = {
        productId: p.id,
        slug: p.slug,
        nameAr: p.nameAr,
        image: p.images[0] ? `/uploads/${p.images[0].fileKey}/thumb.webp` : null,
        shop: { slug: p.vendor.slug, nameAr: p.vendor.nameAr },
        savedPrice: saved,
        available,
        hasVariants: visible && p.variants.length > 1,
        variantId: visible && p.variants.length === 1 ? cheapest!.id : null,
        savedAt: r.createdAt.toISOString(),
      };

      if (!visible) return { ...base, currentPrice: null, delta: null, state: 'unavailable' };

      const now = cheapest.priceMinorUnits;
      // بائع غيّر عملة تسويته بعد الحفظ: لا مقارنة بين عملتين — السعر الحالي وحده
      const comparable = currency === r.currency;
      const diff = comparable ? now - r.savedPriceMinorUnits : 0n;
      const state: WishlistState =
        available <= 0
          ? 'sold_out'
          : diff < 0n
            ? 'drop'
            : diff > 0n
              ? 'rise'
              : available <= WISHLIST_LOW_STOCK
                ? 'low'
                : 'ok';

      return {
        ...base,
        currentPrice: shown(fx, now, currency),
        delta: diff !== 0n ? shown(fx, diff < 0n ? -diff : diff, currency) : null,
        state,
      };
    });

    return { items, count: items.length, max: MAX_WISHLIST };
  }

  /** يسلسل ما يمسّ قائمة المستخدم الواحد — انظر تعليق الصنف */
  private async lockOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
    if (rows.length === 0) throw new NotFoundError(NOT_FOUND);
  }
}
