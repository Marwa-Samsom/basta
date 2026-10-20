import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConflictError, DuplicateError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ScopedRepository } from '../../../common/prisma/scoped-repository';
import type { VendorScope } from '../../../common/security/actor';
import type { Tx } from '../../inventory/public';
import { lookupKey } from '../domain/import-plan';
import { isUniqueViolation } from './attribute.service';
import { StorefrontService } from './storefront.service';

export interface VendorCategoryView {
  readonly id: string;
  readonly nameAr: string;
  readonly sort: number;
  /** منتجات المتجر فيها — المحذوفة لا تُعدّ */
  readonly productCount: number;
}

/** حدّ فئات المتجر الواحد — قائمة تختار منها يدٌ لا جدول بلا نهاية */
export const MAX_VENDOR_CATEGORIES = 200;

/** فراغات موحّدة: «ملابس   رجالية » و «ملابس رجالية» اسم واحد */
export const cleanCategoryName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/**
 * فئات المتجر — قرار صاحب المشروع 14 أكتوبر 2026: «كل متجر له فئاته ومنتجاته
 * بشكل منفصل، ينشئها دون تدخّل الإدارة».
 *
 * لا مراجعة ولا حدّ إلا العدد: الفئة ترتيب البائع لرفّه. كل قراءة وكتابة عبر ScopedRepository،
 * والمفتاح الأجنبي المركّب في القاعدة يمنع منتجاً من فئة متجر آخر ولو تجاوز أحدٌ هذا.
 */
@Injectable()
export class VendorCategoryService {
  private readonly logger = new Logger('VendorCategories');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storefront: StorefrontService,
  ) {}

  private repo(scope: VendorScope, db: Tx | PrismaService = this.prisma) {
    return new ScopedRepository<{ id: string }>(db.vendorCategory as never, scope, 'الفئة');
  }

  async list(scope: VendorScope): Promise<VendorCategoryView[]> {
    const rows = (await this.repo(scope).findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        nameAr: true,
        sort: true,
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    })) as unknown as { id: string; nameAr: string; sort: number; _count: { products: number } }[];
    return rows.map((r) => ({ id: r.id, nameAr: r.nameAr, sort: r.sort, productCount: r._count.products }));
  }

  /** فئة جديدة في آخر القائمة */
  async create(scope: VendorScope, nameAr: string): Promise<VendorCategoryView> {
    const name = this.validName(nameAr);
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const repo = this.repo(scope, tx);
      const count = await repo.count();
      if (count >= MAX_VENDOR_CATEGORIES) {
        throw new InvalidInputError(`بلغ متجرك حدّ ${MAX_VENDOR_CATEGORIES} فئة. ادمج فئات متقاربة أو احذف ما لا تستعمله.`);
      }
      const last = (await repo.findFirst({ orderBy: { sort: 'desc' }, select: { sort: true } })) as { sort: number } | null;
      await this.write(name, () =>
        tx.vendorCategory.create({
          data: { id, vendorId: scope.vendorId, nameAr: name, sort: (last?.sort ?? -1) + 1 },
        }),
      );
    });
    return this.one(scope, id);
  }

  async rename(scope: VendorScope, id: string, nameAr: string): Promise<VendorCategoryView> {
    const name = this.validName(nameAr);
    await this.write(name, () => this.repo(scope).updateOwned(id, { nameAr: name }));
    // الاسم في وثيقة البحث يُبحث به — منتجات الفئة تُعاد فهرستها
    this.reindex(scope, id);
    return this.one(scope, id);
  }

  /** الترتيب الجديد كاملاً: كل فئات المتجر بلا نقص ولا زيادة، والأولى أولاً */
  async reorder(scope: VendorScope, ids: readonly string[]): Promise<VendorCategoryView[]> {
    await this.prisma.$transaction(async (tx) => {
      const repo = this.repo(scope, tx);
      const own = (await repo.findMany({ select: { id: true } })) as { id: string }[];
      const known = new Set(own.map((c) => c.id));
      if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
        throw new InvalidInputError('أرسل كل فئات متجرك بترتيبها الجديد، كلٌّ مرة واحدة.');
      }
      for (const [sort, id] of ids.entries()) await repo.updateOwned(id, { sort });
    });
    return this.list(scope);
  }

  /**
   * فئة فيها منتج حيّ لا تُحذف — حذفها كان يخرجه بلا فئة، ولا منتج بلا فئة منذ
   * 18 أكتوبر 2026. المؤرشف وحده يخرج منها (لا يُعرض ولا يُحرَّر)، والإفراغ والحذف
   * في معاملة واحدة — المفتاح الأجنبي RESTRICT يرفض حذف فئة بقي فيها منتج.
   */
  async remove(scope: VendorScope, id: string): Promise<{ productsUncategorized: number }> {
    const products = await this.prisma.$transaction(async (tx) => {
      await this.repo(scope, tx).findByIdOrFail(id, { select: { id: true } });
      // ملكيته ثبتت في السطر السابق — الاسم للرسالة وحدها
      const category = await tx.vendorCategory.findUniqueOrThrow({ where: { id }, select: { nameAr: true } });
      const live = await tx.product.count({ where: { vendorId: scope.vendorId, vendorCategoryId: id, deletedAt: null } });
      if (live > 0) {
        throw new ConflictError(`«${category.nameAr}» فيها ${live} ${live === 1 ? 'منتج' : 'منتجات'} — انقلها إلى فئة أخرى قبل حذفها.`, {
          vendorCategoryId: id,
          products: live,
        });
      }
      const affected = await tx.product.findMany({
        where: { vendorId: scope.vendorId, vendorCategoryId: id },
        select: { id: true },
      });
      await tx.product.updateMany({
        where: { vendorId: scope.vendorId, vendorCategoryId: id },
        data: { vendorCategoryId: null },
      });
      await this.repo(scope, tx).deleteOwned(id);
      return affected.map((p) => p.id);
    });
    this.syncLater(products);
    return { productsUncategorized: products.length };
  }

  /** فئة المنتج من متجره وحده — المعرّف الغريب يُرفض كغير الموجود (ADR-010) */
  async assertOwned(scope: VendorScope, id: string, db: Tx | PrismaService = this.prisma): Promise<void> {
    const found = await this.repo(scope, db).findFirst({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundError('الفئة غير موجودة في متجرك.', { vendorCategoryId: id });
  }

  /**
   * للاستيراد: معرّف كل اسم، وما غاب يُنشأ في المعاملة نفسها. المطابقة بمفتاح
   * lookupKey كالخيارات والقيم — «ملابس» و «ملابس » و «ملابس» بحالة أخرى واحد.
   */
  async idsByName(tx: Tx, scope: VendorScope, names: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (names.length === 0) return out;
    const repo = this.repo(scope, tx);
    const existing = (await repo.findMany({ select: { id: true, nameAr: true, sort: true } })) as {
      id: string;
      nameAr: string;
      sort: number;
    }[];
    for (const c of existing) out.set(lookupKey(c.nameAr), c.id);

    const missing = [...new Map(names.map((n) => [lookupKey(n), cleanCategoryName(n)])).entries()].filter(
      ([key]) => !out.has(key),
    );
    if (existing.length + missing.length > MAX_VENDOR_CATEGORIES) {
      throw new InvalidInputError(`الملف ينشئ فئات تتجاوز حدّ ${MAX_VENDOR_CATEGORIES} فئة للمتجر.`);
    }
    let sort = existing.reduce((max, c) => Math.max(max, c.sort), -1);
    for (const [key, name] of missing) {
      const id = randomUUID();
      sort += 1;
      await tx.vendorCategory.create({ data: { id, vendorId: scope.vendorId, nameAr: this.validName(name), sort } });
      out.set(key, id);
    }
    return out;
  }

  // ------------------------------------------------------------------ داخلي

  private async one(scope: VendorScope, id: string): Promise<VendorCategoryView> {
    const found = (await this.list(scope)).find((c) => c.id === id);
    if (!found) throw new NotFoundError('الفئة غير موجودة.', { id });
    return found;
  }

  private validName(nameAr: string): string {
    const name = cleanCategoryName(nameAr);
    if (name.length < 1 || name.length > 80) throw new InvalidInputError('اسم الفئة من حرف إلى 80 حرفاً.');
    return name;
  }

  private async write<T>(name: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateError(`الفئة «${name}» موجودة في متجرك.`, { nameAr: name });
      throw err;
    }
  }

  private reindex(scope: VendorScope, id: string): void {
    void this.prisma.product
      .findMany({ where: { vendorId: scope.vendorId, vendorCategoryId: id, deletedAt: null }, select: { id: true } })
      .then((rows) => this.syncLater(rows.map((r) => r.id)))
      .catch((err: unknown) => this.logger.error(`تعذّرت قراءة منتجات الفئة ${id} للفهرسة`, err as Error));
  }

  /** الفهرس يتبع ولا يُسقط العملية — كمزامنة المنتج نفسها (ADR-014) */
  private syncLater(productIds: readonly string[]): void {
    void (async () => {
      for (let i = 0; i < productIds.length; i += 500) await this.storefront.syncIndex(productIds.slice(i, i + 500));
    })().catch((err: unknown) => this.logger.error('تعذّرت مزامنة فهرس منتجات الفئة', err as Error));
  }
}
