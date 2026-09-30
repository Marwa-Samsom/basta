import { Injectable } from '@nestjs/common';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../../../common/config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * بوابة صور المنتجات — /uploads/products/<منتج>/<صورة>/<نسخة>.
 *
 * المجلد يُخدَم ملفاتٍ ثابتة لكل من يطلبها، فصور المنتج المرفوض (وقد يُرفض لأن
 * صوره هي المخالفة) والمحذوف والمسودّة تبقى عامة برابطها ما بقي الملف — استضافة
 * مجانية لما لم تعتمده المنصة، باسم نطاقها. تمرّ الصورة إن تحقّق واحد:
 *   1. منتجها ظاهر في المتجر (قاعدة الرؤية نفسها)
 *   2. صورة لقطة في طلب — سجلّ طلبات المشتري يبقى بصوره ولو حُذف المنتج بعده
 *   3. رابط موقَّع — تصدره واجهتا البائع والإدارة وحدهما (مسودّة، قيد المراجعة، مرفوض)
 * وما سواها 404. الحكم مخزَّن دقيقة: الصورة تُطلب بالمئات لكل صفحة.
 */
const PRODUCT_IMAGE = /^\/uploads\/(products\/([0-9a-f-]{36})\/[0-9a-f-]{36})\/[a-z]+\.(?:webp|avif)(?:\?(.*))?$/;
/** المسموح يُخزَّن دقيقة، والمحجوب ثوانيَ: منتج اعتُمد للتوّ لا تُحجب صوره دقيقة */
const ALLOW_TTL_MS = 60_000;
const DENY_TTL_MS = 5_000;

/** رابط يعيش يومين على الأقل، ثابت طوال اليوم — يبقى في ذاكرة المتصفّح والصفحات المخزّنة */
const DAY_S = 86_400;
const expiryNow = (now = Date.now()): number => (Math.floor(now / 1000 / DAY_S) + 3) * DAY_S;

function mac(key: string, exp: number): string {
  const secret = Buffer.from(hkdfSync('sha256', loadEnv().jwtAccessSecret, 'basta', 'product-image-url', 32));
  return createHmac('sha256', secret).update(`${key}.${exp}`).digest('base64url').slice(0, 22);
}

/** توقيع صورة منتج (المفتاح products/<منتج>/<صورة>) — يغطّي نسخها كلها */
export function signImageKey(key: string, now = Date.now()): string {
  const exp = expiryNow(now);
  return `${exp}.${mac(key, exp)}`;
}

export function imageSignatureValid(key: string, signature: string | undefined, now = Date.now()): boolean {
  const [expRaw, given] = (signature ?? '').split('.');
  const exp = Number(expRaw);
  if (!given || !Number.isInteger(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(mac(key, exp));
  const presented = Buffer.from(given);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

@Injectable()
export class ProductImageGate {
  private readonly cache = new Map<string, { ok: boolean; until: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** null: ليس مسار صورة منتج (بانر، شعار…) فلا شأن للبوابة به */
  async allows(url: string): Promise<boolean | null> {
    const m = PRODUCT_IMAGE.exec(url);
    if (!url.startsWith('/uploads/products/')) return null;
    if (!m) return false;
    const [, key, productId, query] = m as unknown as [string, string, string, string | undefined];
    if (imageSignatureValid(key, new URLSearchParams(query ?? '').get('s') ?? undefined)) return true;

    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.ok;
    const [visible, ordered] = await Promise.all([
      this.prisma.product.count({
        where: {
          id: productId,
          status: 'active',
          deletedAt: null,
          vendor: { status: 'approved' },
          images: { some: { fileKey: key } },
        },
      }),
      this.prisma.orderItem.count({ where: { imageKeySnapshot: key }, take: 1 }),
    ]);
    const ok = visible + ordered > 0;
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(key, { ok, until: Date.now() + (ok ? ALLOW_TTL_MS : DENY_TTL_MS) });
    return ok;
  }
}
