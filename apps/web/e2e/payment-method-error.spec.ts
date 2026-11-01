import { expect, test, type Page } from '@playwright/test';
import { makeVendor, signInBuyer, tag } from './fixtures';

/**
 * طريقة الدفع لا تُحمَّل — CHK-061، 31 أكتوبر 2026. جلبها كان يبتلع الخطأ: يبقى «جارٍ
 * تحميل طريقة الدفع…» للأبد و«ادفع» معطّلاً بلا سبب (وجدته صاحبة المشروع والـ API يعيد
 * تشغيله: 502). الآن تنبيه بالسبب و«أعد المحاولة» يجلبها، والعنوان والشحن المحسوب باقيان.
 */
async function toCheckout(page: Page, productSlug: string) {
  await page.goto(`/p/${encodeURIComponent(productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  await page.getByRole('link', { name: 'إتمام الشراء' }).click();
  await page.waitForURL((u) => u.pathname === '/checkout');
}

async function fillAndPrice(page: Page) {
  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الهاتف').fill('+966500000000');
  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').selectOption('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.locator('.sp-sum__total')).toBeVisible();
}

test('طريقة الدفع لا تُحمَّل: تنبيه بالسبب، و«أعد المحاولة» يجلبها فيُفعَّل «ادفع»', async ({ page }) => {
  const v = await makeVendor(tag());
  await signInBuyer(page);

  let fail = true;
  let calls = 0;
  await page.route(
    (url) => url.pathname === '/api/v1/checkout/payment-method',
    (route) => {
      calls++;
      return fail
        ? route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' })
        : route.continue();
    },
  );

  await toCheckout(page, v.productSlug);
  await fillAndPrice(page);

  const failed = page.getByRole('alert').filter({ hasText: 'تعذّر تحميل طريقة الدفع' });
  await expect(failed).toBeVisible();
  await expect(page.getByText('جارٍ تحميل طريقة الدفع…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ادفع' })).toBeDisabled();

  fail = false;
  const before = calls;
  await failed.getByRole('button', { name: 'أعد المحاولة' }).click();

  await expect(page.getByRole('radio', { name: 'بطاقة تنجح' })).toBeChecked();
  await expect(failed).toHaveCount(0);
  expect(calls).toBeGreaterThan(before);
  // العنوان والشحن المحسوب لم يُمسحا، فـ«ادفع» جاهز بلا «احسب الشحن» ثانيةً
  await expect(page.getByLabel('المدينة')).toHaveValue('الرياض');
  await expect(page.locator('.sp-sum__total')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ادفع' })).toBeEnabled();
});
