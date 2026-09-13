/**
 * صور المنتجات — المرحلة 05.
 *
 * كل صورة تُفكّ وتُعاد كتابتها لا تُحفظ كما وصلت:
 *  • الامتداد يكذب، والمحتوى لا — الصيغة تُقرأ من ترويسة الملف نفسه
 *  • إعادة الترميز تُسقط بيانات EXIF (موقع التصوير في صور الهواتف)
 *  • WebP للمتصفحات كلها و AVIF لما يدعمه — نصف الحجم تقريباً بالجودة نفسها (NF-01)
 *
 * التخزين على القرص المحلي خلف واجهة واحدة: المشروع بلا استضافة (القرار 15)،
 * واستبدالها بتخزين كائنات لاحقاً يمسّ هذا الملف وحده.
 */
import { Injectable } from '@nestjs/common';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { DomainError } from '../../../common/errors/domain-error';

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** ضلع أقصر من هذا لا يُظهر المنتج بوضوح في صفحة المنتج */
export const IMAGE_MIN_EDGE = 300;
export const IMAGE_MAX_EDGE = 8000;
/** حارس فكّ الضغط: صورة صغيرة الحجم بأبعاد هائلة تستنفد الذاكرة (قنبلة بكسلات) */
export const IMAGE_MAX_PIXELS = 40_000_000;
export const IMAGE_FULL_EDGE = 1600;
export const IMAGE_THUMB_EDGE = 400;
export const MAX_IMAGES_PER_PRODUCT = 10;

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);

export class ImageRejectedError extends DomainError {
  readonly code = 'IMAGE_REJECTED';
  readonly httpStatus = 422;
}

export type RenditionName = 'full.webp' | 'full.avif' | 'thumb.webp';

export interface ProcessedImage {
  readonly width: number;
  readonly height: number;
  readonly renditions: readonly { readonly name: RenditionName; readonly buffer: Buffer }[];
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > IMAGE_MAX_BYTES) {
    throw new ImageRejectedError(
      `حجم الصورة ${mb(input.length)} م.ب والحد ${mb(IMAGE_MAX_BYTES)} م.ب. صغّرها أو صدّرها بجودة أقل.`,
    );
  }

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageRejectedError('الملف ليس صورة مقروءة. الصيغ المقبولة: JPEG و PNG و WebP و AVIF.');
  }

  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new ImageRejectedError(
      `صيغة ${meta.format ?? 'مجهولة'} غير مقبولة. الصيغ المقبولة: JPEG و PNG و WebP و AVIF.`,
    );
  }

  // صور الهواتف تُخزَّن مقلوبة الأبعاد وتُصحَّح بعلامة الاتجاه — الحدود على الأبعاد المعروضة
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;

  if (width * height > IMAGE_MAX_PIXELS || Math.max(width, height) > IMAGE_MAX_EDGE) {
    throw new ImageRejectedError(
      `أبعاد الصورة ${width}×${height} والحد الأعلى ${IMAGE_MAX_EDGE} بكسل للضلع.`,
    );
  }
  if (Math.min(width, height) < IMAGE_MIN_EDGE) {
    throw new ImageRejectedError(
      `الصورة صغيرة (${width}×${height}): أقصر ضلع ${IMAGE_MIN_EDGE} بكسل على الأقل ليظهر المنتج واضحاً.`,
    );
  }

  const source = sharp(input, { failOn: 'error', limitInputPixels: IMAGE_MAX_PIXELS }).rotate();
  const full = source
    .clone()
    .resize({ width: IMAGE_FULL_EDGE, height: IMAGE_FULL_EDGE, fit: 'inside', withoutEnlargement: true });

  try {
    const [webp, avif, thumb] = await Promise.all([
      full.clone().webp({ quality: 80 }).toBuffer({ resolveWithObject: true }),
      full.clone().avif({ quality: 55, effort: 4 }).toBuffer(),
      source
        .clone()
        .resize({ width: IMAGE_THUMB_EDGE, height: IMAGE_THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer(),
    ]);

    return {
      width: webp.info.width,
      height: webp.info.height,
      renditions: [
        { name: 'full.webp', buffer: webp.data },
        { name: 'full.avif', buffer: avif },
        { name: 'thumb.webp', buffer: thumb },
      ],
    };
  } catch {
    throw new ImageRejectedError('تعذّرت قراءة محتوى الصورة — قد يكون الملف تالفاً. جرّب تصديره من جديد.');
  }
}

/** مجلد الرفع. `uploads/` مستثنى من git في جذر المستودع وفي كل مجلد فرعي. */
export const UPLOADS_ROOT = resolve(process.cwd(), process.env['UPLOADS_DIR'] ?? 'uploads');
export const UPLOADS_URL_PREFIX = '/uploads/';

/** المفتاح نركّبه نحن من معرّفات، لكن الحارس يبقى: مسار بـ .. يكتب خارج المجلد */
const SAFE_KEY = /^[a-z]+(\/[0-9a-f-]{36})+$/;

@Injectable()
export class LocalImageStorage {
  readonly root = UPLOADS_ROOT;

  private dir(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`مفتاح تخزين غير آمن: ${key}`);
    return join(this.root, ...key.split('/'));
  }

  /** كتابة ثم إعادة تسمية: قارئ متزامن لا يرى ملفاً نصف مكتوب */
  async save(key: string, image: ProcessedImage): Promise<void> {
    const dir = this.dir(key);
    await mkdir(dir, { recursive: true });
    for (const r of image.renditions) {
      const target = join(dir, r.name);
      const temp = `${target}.tmp`;
      await writeFile(temp, r.buffer);
      await rename(temp, target);
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.dir(key), { recursive: true, force: true });
  }

  urls(key: string): Record<RenditionName, string> {
    this.dir(key);
    const base = `${UPLOADS_URL_PREFIX}${key}/`;
    return {
      'full.webp': `${base}full.webp`,
      'full.avif': `${base}full.avif`,
      'thumb.webp': `${base}thumb.webp`,
    };
  }
}
