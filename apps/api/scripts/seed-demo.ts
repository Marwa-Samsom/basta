/**
 * بيانات عرض — متجر ومنتجات بصور حقيقية الحجم، لقياس الأداء (LCP بصورة
 * منتج لا بنص) ولجلسات التدريب و UAT. عديم الأثر عند التكرار: المسار ثابت.
 *
 *   npm run demo:seed
 *
 * الصور تُولَّد (تدرّج + ضجيج بحجم صورة هاتف 2400×2400) وتمرّ بخطّ الصور
 * الحقيقي نفسه — WebP و AVIF بعرض 1600 ومصغّرة 400 — فالقياس قياس الإنتاج.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { LocalImageStorage, processProductImage } from '../src/modules/catalog/infrastructure/product-images';
import { hashPassword } from '../src/modules/identity/domain/password';

const prisma = new PrismaClient();
const storage = new LocalImageStorage();

const PRODUCTS = [
  { slug: 'demo-linen-dress', nameAr: 'فستان كتان صيفي', price: 18_900n, hue: [140, 60, 70] },
  { slug: 'demo-ceramic-mug', nameAr: 'كوب خزف مصنوع يدوياً', price: 4_500n, hue: [60, 90, 120] },
  { slug: 'demo-leather-bag', nameAr: 'حقيبة جلد طبيعي', price: 32_000n, hue: [120, 80, 40] },
  { slug: 'demo-olive-soap', nameAr: 'صابون زيت زيتون', price: 1_500n, hue: [90, 110, 60] },
];

async function photo([r, g, b]: number[]): Promise<Buffer> {
  const size = 2400;
  const noise = Buffer.alloc(size * size * 3);
  for (let i = 0; i < noise.length; i += 3) {
    const y = Math.floor(i / 3 / size) / size;
    const n = Math.random() * 40 - 20;
    noise[i] = Math.max(0, Math.min(255, r! + y * 80 + n));
    noise[i + 1] = Math.max(0, Math.min(255, g! + y * 60 + n));
    noise[i + 2] = Math.max(0, Math.min(255, b! + y * 40 + n));
  }
  return sharp(noise, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function main(): Promise<void> {
  const email = 'demo-vendor@basta.local';
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: { email, fullName: 'متجر العرض', passwordHash: await hashPassword(randomUUID()), roles: { create: { role: 'vendor_owner' } } },
    }));
  const vendor =
    (await prisma.vendor.findUnique({ where: { slug: 'demo-store' } })) ??
    (await prisma.vendor.create({
      data: {
        ownerUserId: user.id, slug: 'demo-store', nameAr: 'متجر العرض', status: 'approved', approvedAt: new Date(),
        settlementCurrency: 'SAR', country: 'SA', descriptionAr: 'متجر تجريبي لجلسات التدريب وقياس الأداء.',
        shippingZones: { create: { nameAr: 'الخليج والأردن', regions: { create: [{ country: 'SA' }, { country: 'AE' }, { country: 'JO' }, { country: 'KW' }] }, rates: { create: { method: 'flat', priceMinorUnits: 2_000n } } } },
      },
    }));

  // المتجر يبدأ بالفئات الثماني المقترحة (مشغِّل القاعدة)، ولا منتج بلا فئة
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: vendor.id }, orderBy: { sort: 'asc' } });
  for (const p of PRODUCTS) {
    if (await prisma.product.findUnique({ where: { slug: p.slug } })) continue;
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, vendorCategoryId: category.id, slug: p.slug, nameAr: p.nameAr, descriptionAr: `${p.nameAr} — منتج عرض بصورة بحجم الإنتاج.`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `DEMO-${p.slug}`.toUpperCase(), priceMinorUnits: p.price, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 50, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 50, reason: 'import' } });

    const imageId = randomUUID();
    const key = `products/${product.id}/${imageId}`;
    const processed = await processProductImage(await photo(p.hue));
    await storage.save(key, processed);
    await prisma.productImage.create({ data: { id: imageId, productId: product.id, fileKey: key, altAr: p.nameAr, width: processed.width, height: processed.height, sort: 0 } });
    console.log(`✓ ${p.nameAr}`);
  }
  console.log('بيانات العرض جاهزة: /s/demo-store');
}

main()
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
