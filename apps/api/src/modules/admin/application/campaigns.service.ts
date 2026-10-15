import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorefrontService, type StorefrontProductCard } from '../../catalog/public';
import { signImageKey } from '../../catalog/public';

/** مواضع الحملة في الرئيسية — بترتيب ظهورها. القاعدة تفرضها بقيد CHECK أيضاً */
export const CAMPAIGN_PLACEMENTS = ['home_top', 'home_middle'] as const;
export type CampaignPlacement = (typeof CAMPAIGN_PLACEMENTS)[number];
export type CampaignStatus = 'live' | 'scheduled' | 'ended' | 'paused';

export const CAMPAIGN_MAX_PRODUCTS = 24;

export interface CampaignInput {
  nameAr?: string | undefined;
  placement?: string | undefined;
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  couponId?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface PublicCampaign {
  id: string;
  nameAr: string;
  placement: CampaignPlacement;
  endsAt: Date;
  /** يُعلَن الرمز ما دام الكوبون نفسه صالحاً الآن — الحملة لا تمدّ عمره */
  couponCode: string | null;
  products: StorefrontProductCard[];
}

/**
 * الحالة من الساعة لا من عمود: المنتهية بتاريخها أولاً (موقوفة أو لا — انتهت)،
 * ثم الموقوفة يدوياً، ثم المجدولة، والباقي جارية.
 */
export function campaignStatus(c: { isActive: boolean; startsAt: Date; endsAt: Date }, now: Date): CampaignStatus {
  if (c.endsAt <= now) return 'ended';
  if (!c.isActive) return 'paused';
  if (c.startsAt > now) return 'scheduled';
  return 'live';
}

/** الكوبون صالح الآن: مفعّل، بدأ، لم ينتهِ، ولم تنفد استعمالاته */
function couponLiveNow(c: { isActive: boolean; startsAt: Date | null; endsAt: Date | null; usageLimitTotal: number | null; usedCount: number }, now: Date): boolean {
  return (
    c.isActive &&
    (!c.startsAt || c.startsAt <= now) &&
    (!c.endsAt || c.endsAt > now) &&
    (c.usageLimitTotal === null || c.usedCount < c.usageLimitTotal)
  );
}

/**
 * AD-17 — الحملات: مدة وموضع ومنتجات مرتّبة يدوياً وكوبون يُعلَن معها.
 *
 * **لا حذف.** الحملة تُوقف (`isActive=false`) فتختفي من الواجهة فوراً وتبقى
 * في السجل بمنتجاتها وتدقيقها — كالكوبون. حملة لم تبدأ قط يمكن إيقافها
 * وتعديلها بلا أثر، فلا حاجة لمسار حذف ثانٍ يُختبر ويُحرس.
 *
 * كل تغيير يكتب صفّ AuditLog **في المعاملة نفسها** — لا تغيير بلا أثر.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storefront: StorefrontService,
  ) {}

  // ------------------------------------------------------------- القراءة

  async list(now = new Date()) {
    const rows = await this.prisma.campaign.findMany({
      orderBy: [{ startsAt: 'desc' }],
      include: {
        coupon: { select: { code: true } },
        items: { select: { product: { select: { vendorId: true } } } },
      },
    });

    return rows.map((r) => {
      return {
        id: r.id,
        nameAr: r.nameAr,
        placement: r.placement,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        isActive: r.isActive,
        status: campaignStatus(r, now),
        productCount: r.items.length,
        couponId: r.couponId,
        couponCode: r.coupon?.code ?? null,
        scope: {
          shops: new Set(r.items.map((i) => i.product.vendorId)).size,
        },
      };
    });
  }

  async get(id: string, now = new Date()) {
    const c = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        coupon: { select: { code: true } },
        items: {
          orderBy: { sort: 'asc' },
          select: {
            product: {
              select: {
                id: true,
                nameAr: true,
                slug: true,
                status: true,
                deletedAt: true,
                vendor: { select: { nameAr: true, status: true } },
                images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } },
              },
            },
          },
        },
      },
    });
    if (!c) throw new NotFoundError('الحملة غير موجودة.', { id });
    return {
      id: c.id,
      nameAr: c.nameAr,
      placement: c.placement,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      isActive: c.isActive,
      status: campaignStatus(c, now),
      couponId: c.couponId,
      couponCode: c.coupon?.code ?? null,
      // المخفي يبقى في نظر الإدارة بحالته — يُرى لماذا غاب عن الواجهة
      products: c.items.map(({ product: p }) => ({
        id: p.id,
        nameAr: p.nameAr,
        slug: p.slug,
        status: p.status,
        isDeleted: p.deletedAt !== null,
        shop: { nameAr: p.vendor.nameAr, status: p.vendor.status },
        visible: p.status === 'active' && p.deletedAt === null && p.vendor.status === 'approved',
        // لوحة الإدارة: قد يكون المنتج مخفياً — الرابط موقَّع ليظهر لمن يختاره
        thumbnail: p.images[0] ? `/uploads/${p.images[0].fileKey}/thumb.webp?s=${signImageKey(p.images[0].fileKey)}` : null,
      })),
    };
  }

  /** منتجات منشورة للإضافة إلى حملة — لمن يملك content.manage دون catalog.manage */
  async searchProducts(q: string | undefined) {
    const term = q?.trim();
    const rows = await this.prisma.product.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        ...(term
          ? { OR: [{ nameAr: { contains: term, mode: 'insensitive' } }, { nameEn: { contains: term, mode: 'insensitive' } }, { vendor: { nameAr: { contains: term, mode: 'insensitive' } } }] }
          : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        nameAr: true,
        slug: true,
        vendor: { select: { nameAr: true } },
        images: { take: 1, orderBy: { sort: 'asc' }, select: { fileKey: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      nameAr: p.nameAr,
      slug: p.slug,
      shop: { nameAr: p.vendor.nameAr },
      thumbnail: p.images[0] ? `/uploads/${p.images[0].fileKey}/thumb.webp?s=${signImageKey(p.images[0].fileKey)}` : null,
    }));
  }

  /** كوبونات يمكن إعلانها مع حملة: مفعّلة ولم تنتهِ — دون حاجة إلى coupons.manage */
  couponOptions(now = new Date()) {
    return this.prisma.coupon.findMany({
      where: { isActive: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, endsAt: true },
    });
  }

  // -------------------------------------------------------------- الكتابة

  private async validate(i: { nameAr: string; placement: string; startsAt: string; endsAt: string; couponId?: string | null | undefined }) {
    const name = i.nameAr.trim();
    if (name.length < 3 || name.length > 80) throw new InvalidInputError('اسم الحملة من 3 أحرف إلى 80.');
    if (!(CAMPAIGN_PLACEMENTS as readonly string[]).includes(i.placement)) throw new InvalidInputError('موضع غير معروف.');
    const startsAt = new Date(i.startsAt);
    const endsAt = new Date(i.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new InvalidInputError('البداية والنهاية تاريخان صالحان.');
    if (endsAt <= startsAt) throw new InvalidInputError('نهاية الحملة بعد بدايتها.');
    if (i.couponId) {
      const c = await this.prisma.coupon.findUnique({ where: { id: i.couponId }, select: { isActive: true, endsAt: true, code: true } });
      if (!c) throw new InvalidInputError('الكوبون غير موجود.');
      if (!c.isActive) throw new InvalidInputError(`الكوبون ${c.code} موقوف — فعّله أولاً أو اختر غيره.`);
      if (c.endsAt && c.endsAt <= new Date()) throw new InvalidInputError(`الكوبون ${c.code} منتهٍ.`);
    }
    return { nameAr: name, placement: i.placement, startsAt, endsAt, couponId: i.couponId ?? null };
  }

  private audit(tx: Prisma.TransactionClient, actorUserId: string, action: string, entityId: string, after: unknown, before?: unknown) {
    return tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: 'admin',
        action,
        entityType: 'Campaign',
        entityId,
        afterJson: after as Prisma.InputJsonValue,
        ...(before !== undefined ? { beforeJson: before as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async create(actorId: string, i: CampaignInput) {
    if (!i.nameAr || !i.placement || !i.startsAt || !i.endsAt) throw new InvalidInputError('الاسم والموضع والبداية والنهاية مطلوبة.');
    const data = await this.validate({ ...i, nameAr: i.nameAr, placement: i.placement, startsAt: i.startsAt, endsAt: i.endsAt });
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.campaign.create({ data: { ...data, isActive: i.isActive ?? true, updatedBy: actorId } });
      await this.audit(tx, actorId, 'campaign.create', c.id, { ...data, isActive: c.isActive });
      return { id: c.id };
    });
  }

  /** تعديل جزئي: ما لم يُرسل يبقى، والناتج يُتحقّق منه كاملاً */
  async update(actorId: string, id: string, i: CampaignInput) {
    const cur = await this.prisma.campaign.findUnique({ where: { id } });
    if (!cur) throw new NotFoundError('الحملة غير موجودة.', { id });
    const data = await this.validate({
      nameAr: i.nameAr ?? cur.nameAr,
      placement: i.placement ?? cur.placement,
      startsAt: i.startsAt ?? cur.startsAt.toISOString(),
      endsAt: i.endsAt ?? cur.endsAt.toISOString(),
      // الكوبون الحالي لا يُعاد فحصه إن لم يُمَس — إيقاف حملة كوبونها انتهى لا يُرفض
      couponId: i.couponId !== undefined ? i.couponId : null,
    });
    const couponId = i.couponId !== undefined ? i.couponId : cur.couponId;
    const isActive = i.isActive ?? cur.isActive;
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({ where: { id }, data: { ...data, couponId, isActive, updatedBy: actorId } });
      const action = i.isActive !== undefined && i.isActive !== cur.isActive ? (isActive ? 'campaign.resume' : 'campaign.pause') : 'campaign.update';
      await this.audit(
        tx,
        actorId,
        action,
        id,
        { ...data, couponId, isActive },
        { nameAr: cur.nameAr, placement: cur.placement, startsAt: cur.startsAt, endsAt: cur.endsAt, couponId: cur.couponId, isActive: cur.isActive },
      );
    });
  }

  /**
   * منتجات الحملة بترتيبها — تُستبدل كلها في معاملة واحدة. الرفض يسمّي
   * المشكلة: مكرّر، أو غير موجود، أو غير منشور.
   */
  async setProducts(actorId: string, id: string, productIds: readonly string[]) {
    if (productIds.length > CAMPAIGN_MAX_PRODUCTS) throw new InvalidInputError(`الحملة حتى ${CAMPAIGN_MAX_PRODUCTS} منتجاً.`);
    const dup = productIds.find((p, idx) => productIds.indexOf(p) !== idx);
    if (dup) throw new InvalidInputError(`منتج مكرّر في القائمة: ${dup}`);

    const found = await this.prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, nameAr: true, status: true, deletedAt: true } });
    const byId = new Map(found.map((p) => [p.id, p]));
    const missing = productIds.filter((p) => !byId.has(p));
    if (missing.length) throw new InvalidInputError(`منتج غير موجود: ${missing.join('، ')}`);
    const hidden = found.filter((p) => p.status !== 'active' || p.deletedAt !== null);
    if (hidden.length) throw new InvalidInputError(`كل منتجات الحملة منشورة — غير منشور: ${hidden.map((p) => p.nameAr).join('، ')}`);

    await this.prisma.$transaction(async (tx) => {
      const c = await tx.campaign.findUnique({ where: { id }, select: { id: true } });
      if (!c) throw new NotFoundError('الحملة غير موجودة.', { id });
      const before = await tx.campaignProduct.findMany({ where: { campaignId: id }, orderBy: { sort: 'asc' }, select: { productId: true } });
      await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
      if (productIds.length) await tx.campaignProduct.createMany({ data: productIds.map((productId, sort) => ({ campaignId: id, productId, sort })) });
      await tx.campaign.update({ where: { id }, data: { updatedBy: actorId } });
      await this.audit(tx, actorId, 'campaign.products', id, { productIds }, { productIds: before.map((b) => b.productId) });
    });
  }

  // ------------------------------------------------------------- الواجهة

  /**
   * الحملات الجارية الآن للرئيسية: مفعّلة، و startsAt ≤ الآن < endsAt، بترتيب
   * الموضع ثم البداية. البطاقات من مخطّط المميّز نفسه (قاعدة الرؤية، الأسعار،
   * العملة)، والحملة التي لم يبقَ فيها منتج ظاهر لا تُعرض عنواناً فارغاً.
   */
  async publicCampaigns(now = new Date()): Promise<PublicCampaign[]> {
    const rows = await this.prisma.campaign.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: [{ startsAt: 'asc' }],
      include: {
        coupon: { select: { code: true, isActive: true, startsAt: true, endsAt: true, usageLimitTotal: true, usedCount: true } },
        items: { orderBy: { sort: 'asc' }, select: { productId: true } },
      },
    });
    const order = (p: string) => (CAMPAIGN_PLACEMENTS as readonly string[]).indexOf(p);
    rows.sort((a, b) => order(a.placement) - order(b.placement) || a.startsAt.getTime() - b.startsAt.getTime());

    const out: PublicCampaign[] = [];
    for (const r of rows) {
      const products = await this.storefront.cardsByIds(r.items.map((i) => i.productId));
      if (products.length === 0) continue;
      out.push({
        id: r.id,
        nameAr: r.nameAr,
        placement: r.placement as CampaignPlacement,
        endsAt: r.endsAt,
        couponCode: r.coupon && couponLiveNow(r.coupon, now) ? r.coupon.code : null,
        products,
      });
    }
    return out;
  }
}
