import { expect, test } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * بلا متجر بالجملة كاملة: «لا متجر باسم» وتحتها «متاجر قريبة من بحثك» بكلمة منها. كتبت صاحبة المشروع
 * «متجر الصوف» فلم يُقترح «بيت الصوف» (DISC-075، 29 أكتوبر 2026).
 */
test('«دكان <اسم>» لا يطابق «متجر <اسم>» — ويقترحه تحت «لا متجر باسم»', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  try {
    const q = `دكان ${t}`;
    await page.goto(`/shops?name=${encodeURIComponent(q)}`);
    await expect(page.getByText(`لا متجر باسم «${q}»`)).toBeVisible();
    const near = page.getByRole('region', { name: 'متاجر قريبة من بحثك' });
    await expect(near).toBeVisible();
    await expect(near.getByRole('link', { name: new RegExp(`متجر ${t}`) })).toHaveAttribute('href', `/s/store-${t}`);
  } finally {
    // متجر تجريبي معتمد يبقى في دليل المتاجر على قاعدة التطوير
    await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });
  }
});
