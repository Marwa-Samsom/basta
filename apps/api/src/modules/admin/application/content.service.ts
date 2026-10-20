import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { dirOf, like, pageArgs, type SortOrder } from '../../../common/paging';
import { UPLOADS_ROOT, UPLOADS_URL_PREFIX } from '../../catalog/public';

/**
 * مسار داخل الموقع لا موقع آخر. `^/` وحدها تقبل `//evil.com` — رابط لموقع آخر
 * بلا بروتوكول. والمتصفح يحذف التاب وسطر الجديد ويقرأ `\` كـ `/`، فيُرفض كل محرف
 * تحكّم أو مسافة وكل `\`، ثم يجب أن يبقى المسار المحلَّل على الأصل نفسه.
 * نسخة الواجهة: internalPath في apps/web/src/lib/safe-path.ts — القاعدة نفسها.
 */
export function isInternalPath(raw: string): boolean {
  if (raw[0] !== '/' || /[\x00-\x20\x7f\\]/.test(raw)) return false;
  try {
    return new URL(raw, 'https://basta.invalid').origin === 'https://basta.invalid';
  } catch {
    return false;
  }
}

export const BANNER_PLACEMENTS = ['home_hero', 'home_middle'] as const;
const FEATURED_KEY = 'home_featured_product_ids';

export interface CouponInput {
  code: string;
  scope: 'platform' | 'vendor';
  vendorId?: string | null;
  type: 'percent' | 'fixed' | 'free_shipping';
  valueBps?: number | null;
  valueMinorUnits?: string | null;
  maxDiscountMinorUnits?: string | null;
  minOrderMinorUnits?: string | null;
  currency?: string | null;
  usageLimitTotal?: number | null;
  usageLimitPerUser?: number | null;
  fundedBy: 'platform' | 'vendor';
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}

const big = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : BigInt(v));

/**
 * المحتوى والتسويق — AD-16…19 و AD-22. الكوبون لا يُحذف بعد استعماله
 * (له استردادات مرتبطة بطلبات)، يُوقف فقط.
 */
@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  private audit(actorUserId: string, action: string, entityType: string, entityId: string, after?: unknown) {
    return this.prisma.auditLog.create({
      data: { actorUserId, actorRole: 'admin', action, entityType, entityId, afterJson: (after ?? null) as Prisma.InputJsonValue },
    });
  }

  // ----------------------------------------------------------- الكوبونات

  async coupons() {
    const rows = await this.prisma.coupon.findMany({ orderBy: { code: 'asc' }, include: { vendor: { select: { nameAr: true } } } });
    return rows.map((c) => ({
      ...c,
      valueMinorUnits: c.valueMinorUnits?.toString() ?? null,
      maxDiscountMinorUnits: c.maxDiscountMinorUnits?.toString() ?? null,
      minOrderMinorUnits: c.minOrderMinorUnits?.toString() ?? null,
    }));
  }

  private validateCoupon(i: CouponInput) {
    if (!/^[A-Z0-9_-]{3,30}$/.test(i.code)) throw new InvalidInputError('الرمز بأحرف لاتينية كبيرة وأرقام، 3–30.');
    if (i.scope === 'vendor' && !i.vendorId) throw new InvalidInputError('كوبون المتجر يحتاج المتجر.');
    if (i.type === 'percent' && (!i.valueBps || i.valueBps < 1 || i.valueBps > 9000)) throw new InvalidInputError('النسبة بين 0.01% و 90%.');
    if (i.type === 'fixed' && (!i.valueMinorUnits || !i.currency)) throw new InvalidInputError('المبلغ الثابت يحتاج قيمة وعملة.');
    if (i.startsAt && i.endsAt && new Date(i.endsAt) <= new Date(i.startsAt)) throw new InvalidInputError('نهاية الصلاحية بعد بدايتها.');
    // Q-06: كوبون المنصة تموّله المنصة — تحميله على متجر يحتاج موافقته
    if (i.scope === 'platform' && i.fundedBy === 'vendor') throw new InvalidInputError('كوبون المنصة تموّله المنصة.');
  }

  private couponData(i: CouponInput) {
    return {
      code: i.code,
      scope: i.scope,
      vendorId: i.scope === 'vendor' ? (i.vendorId ?? null) : null,
      type: i.type,
      valueBps: i.type === 'percent' ? (i.valueBps ?? null) : null,
      valueMinorUnits: i.type === 'fixed' ? big(i.valueMinorUnits) : null,
      maxDiscountMinorUnits: big(i.maxDiscountMinorUnits),
      minOrderMinorUnits: big(i.minOrderMinorUnits),
      currency: i.currency ?? null,
      usageLimitTotal: i.usageLimitTotal ?? null,
      usageLimitPerUser: i.usageLimitPerUser ?? null,
      fundedBy: i.fundedBy,
      startsAt: i.startsAt ? new Date(i.startsAt) : null,
      endsAt: i.endsAt ? new Date(i.endsAt) : null,
      isActive: i.isActive ?? true,
    };
  }

  async createCoupon(actorId: string, i: CouponInput) {
    this.validateCoupon(i);
    try {
      const c = await this.prisma.coupon.create({ data: this.couponData(i) });
      await this.audit(actorId, 'coupon.create', 'Coupon', c.id, { ...i });
      return { id: c.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictError('الرمز مستعمل.');
      throw err;
    }
  }

  async updateCoupon(actorId: string, id: string, i: CouponInput) {
    this.validateCoupon(i);
    const c = await this.prisma.coupon.findUnique({ where: { id } });
    if (!c) throw new NotFoundError('الكوبون غير موجود.', { id });
    // استُعمل: القيمة والتمويل مثبّتة في لقطات الطلبات؛ تغييرهما يربك التقارير
    if (c.usedCount > 0 && (c.type !== i.type || c.fundedBy !== i.fundedBy || c.code !== i.code)) {
      throw new ConflictError('كوبون مستعمل: لا يتغيّر رمزه ولا نوعه ولا ممّوله. أوقفه وأنشئ غيره.');
    }
    await this.prisma.coupon.update({ where: { id }, data: this.couponData(i) });
    await this.audit(actorId, 'coupon.update', 'Coupon', id, { ...i });
  }

  // -------------------------------------------------------------- الصفحات

  pages() {
    return this.prisma.cmsPage.findMany({ orderBy: { slug: 'asc' } });
  }

  async savePage(actorId: string, input: { id?: string; slug: string; titleAr: string; bodyAr: string; isPublished: boolean }) {
    if (!/^[a-z0-9-]{2,60}$/.test(input.slug)) throw new InvalidInputError('المسار بأحرف لاتينية صغيرة وأرقام وشرطات.');
    try {
      const page = input.id
        ? await this.prisma.cmsPage.update({ where: { id: input.id }, data: { slug: input.slug, titleAr: input.titleAr.trim(), bodyAr: input.bodyAr, isPublished: input.isPublished, updatedBy: actorId } })
        : await this.prisma.cmsPage.create({ data: { slug: input.slug, titleAr: input.titleAr.trim(), bodyAr: input.bodyAr, isPublished: input.isPublished, updatedBy: actorId } });
      await this.audit(actorId, 'page.save', 'CmsPage', page.id, { slug: page.slug, isPublished: page.isPublished });
      return page;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictError('المسار مستعمل.');
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundError('الصفحة غير موجودة.');
      throw err;
    }
  }

  async publicPage(slug: string) {
    const p = await this.prisma.cmsPage.findFirst({ where: { slug, isPublished: true }, select: { slug: true, titleAr: true, bodyAr: true, updatedAt: true } });
    if (!p) throw new NotFoundError('الصفحة غير موجودة.', { slug });
    return p;
  }

  // -------------------------------------------------------------- البانرات

  async banners() {
    const rows = await this.prisma.banner.findMany({ orderBy: [{ placement: 'asc' }, { sort: 'asc' }] });
    return rows.map((b) => ({ ...b, imageUrl: `${UPLOADS_URL_PREFIX}${b.imageKey}/full.webp` }));
  }

  /** صورة البانر: WebP بعرض 1600 بحدّ أقصى — تُرفع أولاً ثم يُحفظ البانر بمفتاحها */
  async uploadBannerImage(buffer: Buffer): Promise<{ imageKey: string; imageUrl: string }> {
    let out: Buffer;
    try {
      const img = sharp(buffer, { failOn: 'error' });
      const meta = await img.metadata();
      if ((meta.width ?? 0) < 600) throw new InvalidInputError('عرض صورة البانر 600 بكسل على الأقل.');
      out = await img.rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch (err) {
      if (err instanceof InvalidInputError) throw err;
      throw new InvalidInputError('الملف ليس صورة صالحة.');
    }
    const key = `banners/${randomUUID()}`;
    const dir = join(UPLOADS_ROOT, ...key.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'full.webp'), out);
    return { imageKey: key, imageUrl: `${UPLOADS_URL_PREFIX}${key}/full.webp` };
  }

  async saveBanner(
    actorId: string,
    input: { id?: string; placement: string; imageKey: string; linkUrl?: string | null; titleAr?: string | null; sort?: number; startsAt?: string | null; endsAt?: string | null; isActive: boolean },
  ) {
    if (!(BANNER_PLACEMENTS as readonly string[]).includes(input.placement)) throw new InvalidInputError('موضع غير معروف.');
    if (!/^banners\/[0-9a-f-]{36}$/.test(input.imageKey)) throw new InvalidInputError('ارفع صورة البانر أولاً.');
    if (input.linkUrl && !isInternalPath(input.linkUrl)) throw new InvalidInputError('الرابط مسار داخل الموقع يبدأ بـ / (لا // ولا \\ ولا مسافات).');
    const data = {
      placement: input.placement,
      imageKey: input.imageKey,
      linkUrl: input.linkUrl || null,
      titleAr: input.titleAr?.trim() || null,
      sort: input.sort ?? 0,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      isActive: input.isActive,
      updatedBy: actorId,
    };
    const b = input.id ? await this.prisma.banner.update({ where: { id: input.id }, data }) : await this.prisma.banner.create({ data });
    await this.audit(actorId, 'banner.save', 'Banner', b.id, data);
    return b;
  }

  async publicBanners(placement: string) {
    const now = new Date();
    const rows = await this.prisma.banner.findMany({
      where: {
        placement,
        isActive: true,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: { sort: 'asc' },
      select: { id: true, titleAr: true, linkUrl: true, imageKey: true },
    });
    return rows.map((b) => ({ id: b.id, titleAr: b.titleAr, linkUrl: b.linkUrl, imageUrl: `${UPLOADS_URL_PREFIX}${b.imageKey}/full.webp` }));
  }

  // ------------------------------------------------------------- المميّز

  /**
   * المميّز بترتيبه، ومع كل معرّف اسم المنتج ومتجره. كانت اللوحة تأخذ الأسماء من أول مئة
   * منتج منشور، فالمميّز خارجها يظهر بأول معرّفه. `active: false` لمنتج لم يعد منشوراً —
   * يُزال قبل أي حفظ، لأن الحفظ يقبل المنشور وحده.
   */
  async featured(): Promise<{ id: string; nameAr: string | null; vendor: string | null; active: boolean }[]> {
    const row = await this.prisma.setting.findUnique({ where: { key: FEATURED_KEY } });
    const ids = Array.isArray(row?.valueJson) ? (row.valueJson as string[]) : [];
    const found = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameAr: true, status: true, deletedAt: true, vendor: { select: { nameAr: true } } },
    });
    return ids.map((id) => {
      const p = found.find((x) => x.id === id);
      return { id, nameAr: p?.nameAr ?? null, vendor: p?.vendor.nameAr ?? null, active: !!p && p.status === 'active' && !p.deletedAt };
    });
  }

  async setFeatured(actorId: string, productIds: string[]) {
    const unique = [...new Set(productIds)].slice(0, 24);
    const found = await this.prisma.product.count({ where: { id: { in: unique }, status: 'active', deletedAt: null } });
    if (found !== unique.length) throw new InvalidInputError('كل المميّز منتجات منشورة.');
    await this.prisma.setting.upsert({
      where: { key: FEATURED_KEY },
      create: { key: FEATURED_KEY, valueJson: unique, updatedBy: actorId },
      update: { valueJson: unique, updatedBy: actorId },
    });
    await this.audit(actorId, 'storefront.featured', 'Setting', FEATURED_KEY, { productIds: unique });
  }

  // --------------------------------------------------------- مراجعات المنتجات

  /** AD-22 — بالحالة والبحث (المنتج، أو اسم المشتري أو بريده، أو نصّ المراجعة) وخمسين خمسين */
  async reviews(q: { status?: string; search?: string; page: number; sort?: SortOrder }) {
    const t = q.search;
    const where: Prisma.ReviewWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(t ? { OR: [{ product: { nameAr: like(t) } }, { user: { OR: [{ fullName: like(t) }, { email: like(t) }] } }, { title: like(t) }, { body: like(t) }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: dirOf(q.sort, 'newest') }, { id: 'asc' }],
        ...pageArgs(q.page),
        include: { product: { select: { nameAr: true, slug: true } }, user: { select: { fullName: true } } },
      }),
      this.prisma.review.count({ where }),
    ]);
    return { items, total };
  }

  async moderateReview(actorId: string, id: string, status: 'published' | 'rejected', reason?: string | null) {
    if (status === 'rejected' && (reason?.trim().length ?? 0) < 5) throw new InvalidInputError('سبب الإخفاء مطلوب.');
    const { count } = await this.prisma.review.updateMany({
      where: { id },
      data: { status, rejectReason: status === 'rejected' ? reason!.trim() : null },
    });
    if (count === 0) throw new NotFoundError('المراجعة غير موجودة.', { id });
    await this.audit(actorId, `review.${status}`, 'Review', id, { reason: reason ?? null });
  }
}
