import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ScopedRepository } from '../../../common/prisma/scoped-repository';
import type { VendorScope } from '../../../common/security/actor';
import {
  ImageRejectedError,
  LocalImageStorage,
  MAX_IMAGES_PER_PRODUCT,
  processProductImage,
} from '../infrastructure/product-images';
import type { ProductImageView } from './views';

/** صور المنتج: تُعالَج وتُخزَّن ثم يُكتب صفّها — والفشل بينهما لا يترك ملفاً يتيماً. */
@Injectable()
export class ProductImageService {
  private readonly logger = new Logger('ProductImages');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalImageStorage,
  ) {}

  async add(
    scope: VendorScope,
    productId: string,
    file: Buffer,
    meta: { variantId?: string | null | undefined; altAr?: string | null | undefined; altEn?: string | null | undefined },
  ): Promise<ProductImageView> {
    const product = (await new ScopedRepository(this.prisma.product as never, scope, 'المنتج').findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, _count: { select: { images: true } } },
    })) as { id: string; _count: { images: number } } | null;
    if (!product) throw new NotFoundError('المنتج غير موجود.', { productId });

    if (product._count.images >= MAX_IMAGES_PER_PRODUCT) {
      throw new ImageRejectedError(`الحد ${MAX_IMAGES_PER_PRODUCT} صور للمنتج. احذف صورة قبل إضافة أخرى.`);
    }

    if (meta.variantId) {
      const variant = await new ScopedRepository(this.prisma.productVariant as never, scope, 'المتغيّر').findFirst({
        where: { id: meta.variantId, productId, archivedAt: null },
        select: { id: true },
      });
      if (!variant) throw new NotFoundError('المتغيّر غير موجود.', { variantId: meta.variantId });
    }

    const processed = await processProductImage(file);
    const imageId = randomUUID();
    const key = `products/${productId}/${imageId}`;
    await this.storage.save(key, processed);

    try {
      const image = await this.prisma.productImage.create({
        data: {
          id: imageId,
          productId,
          variantId: meta.variantId ?? null,
          fileKey: key,
          altAr: meta.altAr?.trim() || null,
          altEn: meta.altEn?.trim() || null,
          width: processed.width,
          height: processed.height,
          sort: product._count.images,
        },
      });
      await this.contentChanged(scope, productId);
      return {
        id: image.id,
        variantId: image.variantId,
        altAr: image.altAr,
        altEn: image.altEn,
        width: image.width,
        height: image.height,
        sort: image.sort,
        urls: this.storage.urls(key),
      };
    } catch (err) {
      await this.storage.remove(key);
      throw err;
    }
  }

  async remove(scope: VendorScope, productId: string, imageId: string): Promise<void> {
    const product = await new ScopedRepository(this.prisma.product as never, scope, 'المنتج').findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود.', { productId });

    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw new NotFoundError('الصورة غير موجودة.', { imageId });

    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.contentChanged(scope, productId);
    // الصف حُذف فالصورة غير مرئية؛ ملف لم يُحذف يُسجَّل ولا يُفشل طلب البائع
    await this.storage.remove(image.fileKey).catch((err: unknown) =>
      this.logger.error(`تعذّر حذف ملفات الصورة ${image.fileKey}`, err as Error),
    );
  }

  /**
   * Q-16: الصور محتوى يراه المشتري — إضافتها أو حذفها نسخة محتوى جديدة (فلا يُعتمد
   * ما فتحه المراجِع قبلها)، وفي منتج منشور تعيده للمراجعة.
   * الشرط على الحالة داخل الكتابة: منتج غير منشور لا تتغيّر حالته.
   */
  private async contentChanged(scope: VendorScope, productId: string): Promise<void> {
    const products = new ScopedRepository(this.prisma.product as never, scope, 'المنتج');
    await products.updateWhere({ id: productId, deletedAt: null }, { contentRevision: { increment: 1 } });
    await products.updateWhere({ id: productId, status: 'active', deletedAt: null }, { status: 'pending_review' });
  }
}
