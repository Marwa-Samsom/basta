import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * صفحة حالة المتجر المرفوض: العنوان «طلبك يحتاج تعديلاً» كالتصميم وإشعار الرفض، والبطاقة تحته تقول ما
 * يُفعل كبطاقة المسوّدة — كانت تكرّر العنوان بمرادف «طلبك يحتاج تصحيحاً» (VON-051، 28 أكتوبر 2026).
 */
test('المرفوض: «طلبك يحتاج تعديلاً» ثم «عدّل طلبك وأرسله من جديد» — لا «تصحيحاً»', async ({ page }) => {
  const v = await makeVendor(tag());
  await prisma.vendor.update({
    where: { id: v.vendorId },
    data: { status: 'rejected', approvedAt: null, rejectedAt: new Date(), rejectionReason: 'اسم المتجر لا يطابق السجل التجاري.' },
  });
  await page.goto('/login?next=/vendor/onboarding/status');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/onboarding/status');

  await expect(page.getByRole('heading', { level: 1, name: 'طلبك يحتاج تعديلاً' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'عدّل طلبك وأرسله من جديد' })).toBeVisible();
  await expect(page.locator('.vo-rejection')).toContainText('اسم المتجر لا يطابق السجل التجاري.');
  await expect(page.getByText('تصحيح')).toHaveCount(0);
});
