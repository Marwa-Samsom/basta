import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
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
    // آخر الترتيب لا عدد الصور: بعد حذف صورة كان العدد يساوي ترتيب صورة باقية،
    // فتتساوى صورتان في الترتيب ويصير أيّهما الرئيسية صدفة
    const last = await this.prisma.productImage.aggregate({ where: { productId }, _max: { sort: true } });

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
          sort: (last._max.sort ?? -1) + 1,
        },
      });
      await this.contentChanged(scope, productId);
      return this.view(image);
    } catch (err) {
      await this.storage.remove(key);
      throw err;
    }
  }

  async remove(scope: VendorScope, productId: string, imageId: string): Promise<void> {
    const product = (await new ScopedRepository(this.prisma.product as never, scope, 'المنتج').findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, status: true, _count: { select: { images: true } } },
    })) as { id: string; status: string; _count: { images: number } } | null;
    if (!product) throw new NotFoundError('المنتج غير موجود.', { productId });

    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw new NotFoundError('الصورة غير موجودة.', { imageId });

    // المنشور والمعروض للمراجعة لا يبقى بلا صورة: حذف صورته الوحيدة كان يعيده للمراجعة
    // (contentChanged) دون أن يمرّ بموانع الإرسال، فيُعتمد منتج بلا صورة
    if (product._count.images <= 1 && (product.status === 'active' || product.status === 'pending_review')) {
      throw new InvalidInputError('هذه الصورة الوحيدة للمنتج. أضف صورة أخرى قبل حذفها — المنتج المعروض لا يبقى بلا صورة.');
    }

    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.contentChanged(scope, productId);
    // الصف حُذف فالصورة غير مرئية؛ ملف لم يُحذف يُسجَّل ولا يُفشل طلب البائع
    await this.storage.remove(image.fileKey).catch((err: unknown) =>
      this.logger.error(`تعذّر حذف ملفات الصورة ${image.fileKey}`, err as Error),
    );
  }

  /**
   * ترتيب الصور: كلها بترتيبها الجديد، والأولى هي الرئيسية (صورة البطاقة في المتجر).
   * المجموعة كاملة لا جزء منها — صورة أُضيفت أو حُذفت منذ فتح البائع الصفحة تُردّ
   * 409 بدل ترتيب نصفه قديم. وتغيير الصورة الرئيسية محتوى يراه المشتري (Q-16)، أما
   * إرسال الترتيب نفسه ثانيةً فلا يغيّر شيئاً ولا يعيد المنتج للمراجعة.
   */
  async reorder(scope: VendorScope, productId: string, imageIds: string[]): Promise<ProductImageView[]> {
    const product = await new ScopedRepository(this.prisma.product as never, scope, 'المنتج').findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود.', { productId });
    if (new Set(imageIds).size !== imageIds.length) throw new InvalidInputError('صورة مكرّرة في الترتيب.');

    const current = await this.prisma.productImage.findMany({ where: { productId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    const known = new Set(current.map((i) => i.id));
    if (current.length !== imageIds.length || imageIds.some((id) => !known.has(id))) {
      throw new ConflictError('تغيّرت صور المنتج منذ فتحت الصفحة. حدّثها ثم رتّب من جديد.', { productId });
    }

    const changed = current.some((img, i) => img.id !== imageIds[i] || img.sort !== i);
    if (changed) {
      await this.prisma.$transaction(
        imageIds.map((id, sort) => this.prisma.productImage.update({ where: { id }, data: { sort } })),
      );
      // الرئيسية تغيّرت ← محتوى جديد؛ تسوية الترتيب وحدها (فجوات قديمة) لا تعيده للمراجعة
      if (current[0]!.id !== imageIds[0]) await this.contentChanged(scope, productId);
    }
    const byId = new Map(current.map((i) => [i.id, i]));
    return imageIds.map((id, sort) => this.view({ ...byId.get(id)!, sort }));
  }

  private view(image: {
    id: string;
    variantId: string | null;
    altAr: string | null;
    altEn: string | null;
    width: number | null;
    height: number | null;
    sort: number;
    fileKey: string;
  }): ProductImageView {
    return {
      id: image.id,
      variantId: image.variantId,
      altAr: image.altAr,
      altEn: image.altEn,
      width: image.width,
      height: image.height,
      sort: image.sort,
      urls: this.storage.urls(image.fileKey),
    };
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
