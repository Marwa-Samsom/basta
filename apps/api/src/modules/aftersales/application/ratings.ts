import type { Prisma } from '@prisma/client';

/** منزلتان كما في العمود numeric(3,2) */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * تقييم المنتج والمتجر من مراجعاتهما المنشورة — BUY-070، 26 أكتوبر 2026.
 *
 * كانت أعمدة ratingAvg و ratingCount لا يحدّثها شيء: مراجعة تُنشر فيبقى «تقييم المتجر»
 * مخفياً (0) في صفحة المنتج والمتجر ودليل المتاجر والمقارنة. يُستدعى مع كل نشر وإخفاء.
 *
 * داخل المعاملة نفسها، ويقفل صف المتجر أولاً: مراجعتان متزامنتان على متجر واحد تُحسبان
 * واحدة بعد الأخرى، فالثانية ترى الأولى ولا يكتب حسابٌ ناقص فوق حساب تام.
 */
export async function refreshRatings(tx: Prisma.TransactionClient, target: { productId: string; vendorId: string }): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "vendors" WHERE "id" = ${target.vendorId}::uuid FOR UPDATE`;
  const [product, vendor] = await Promise.all([
    tx.review.aggregate({ where: { productId: target.productId, status: 'published' }, _avg: { rating: true }, _count: true }),
    tx.review.aggregate({ where: { vendorId: target.vendorId, status: 'published' }, _avg: { rating: true }, _count: true }),
  ]);
  await tx.product.update({
    where: { id: target.productId },
    data: { ratingAvg: round2(product._avg.rating ?? 0), ratingCount: product._count },
  });
  await tx.vendor.update({
    where: { id: target.vendorId },
    data: { ratingAvg: round2(vendor._avg.rating ?? 0), ratingCount: vendor._count },
  });
}
