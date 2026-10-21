import { expect, test } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * حالة المتجر تظهر في صفحته فوراً — التعليق يغلقها والإعادة تفتحها في الزيارة التالية
 * نفسها. كانت الصفحة تُخدم من تخزين دقيقة، فأول زائر بعد إعادة «غزة» رأى «لا يستقبل
 * طلبات حالياً» من نسخة عمرها يوم (J-18، 21 أكتوبر 2026).
 */
test('التعليق والإعادة يظهران في صفحة المتجر في الزيارة التالية', async ({ page }) => {
  const v = await makeVendor(tag());
  const slug = (await prisma.vendor.findUniqueOrThrow({ where: { id: v.vendorId }, select: { slug: true } })).slug;

  try {
    await page.goto(`/s/${slug}`);
    await expect(page.getByText(v.productName)).toBeVisible();

    await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });
    await page.reload();
    await expect(page.getByText('هذا المتجر لا يستقبل طلبات حالياً')).toBeVisible();
    await expect(page.getByText(v.productName)).toHaveCount(0);

    await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'approved', suspendedAt: null } });
    await page.reload();
    await expect(page.getByText(v.productName)).toBeVisible();
    await expect(page.getByText('هذا المتجر لا يستقبل طلبات حالياً')).toHaveCount(0);
  } finally {
    await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'approved', suspendedAt: null } });
  }
});
