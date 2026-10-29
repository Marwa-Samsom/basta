import { expect, test } from '@playwright/test';
import { makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * الكوبون الذي خصم يُسمّى — 27 أكتوبر 2026، بطلب صاحبة المشروع أثناء CHK-032.
 *
 * كان «الخصم» رقماً بلا اسم في ملخّص الدفع وصفحة الطلب، و«تمّ طلبك» لا يذكره. الآن:
 * «الخصم (الرمز)» في الملخّصين، و«وفّرت … بكوبون الرمز» تحت إجمالي «تمّ طلبك».
 */
test('خصم 10% بكوبون: الرمز في ملخّص الدفع و«تمّ طلبك» وصفحة الطلب', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const code = `SAVE-${t}`.toUpperCase();
  await prisma.coupon.create({ data: { code, scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' } });
  await signInBuyer(page, t);

  await page.goto(`/p/${encodeURIComponent(v.productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  await page.getByLabel('كود الخصم').fill(code);
  await page.getByRole('button', { name: 'طبّق' }).click();
  await expect(page.getByText('الكوبون المطبَّق:')).toBeVisible();

  await page.getByRole('link', { name: 'إتمام الشراء' }).click();
  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الهاتف').fill('+966500000000');
  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').selectOption('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.locator('.sp-sum dt', { hasText: 'الخصم' })).toHaveText(`الخصم (${code})`);
  // 10% من سعر المنتج بعملة العرض — الرقم نفسه يُذكر في «وفّرت»
  const discount = (await page.locator('.sp-sum__saving').innerText()).match(/[\d.,]+/)![0];

  await page.getByRole('button', { name: 'ادفع' }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByRole('heading', { name: 'تمّ طلبك' })).toBeVisible();
  const saved = page.locator('.sp-hero__text', { hasText: 'وفّرت' });
  await expect(saved).toContainText(code);
  await expect(saved).toContainText(discount);

  await page.getByRole('link', { name: 'تابع الطلب' }).click();
  await page.waitForURL(/\/account\/orders\//);
  await expect(page.locator('dt', { hasText: 'الخصم' })).toHaveText(`الخصم (${code})`);
});
