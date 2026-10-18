import { expect, test } from '@playwright/test';
import { makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * إصلاحات سريعة في تجربة المشتري (UX-OPS-AUDIT §3): ما كان يصله إنجليزياً أو يعلق فيه.
 */

test('الأرقام العربية في خانة الرمز تُكتب لاتينية — لا تُحذف بصمت', async ({ page }) => {
  await page.goto('/reset');
  const code = page.getByLabel('رمز الاستعادة');
  await code.fill('٤٨٢٩١٣');
  await expect(code).toHaveValue('482913');
});

test('الدفع: الزر ينتظر الاسم والشارع والهاتف، وانقطاع الشبكة رسالة عربية، والضريبة في ملخّص الطلب', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  await page.goto(`/p/${encodeURIComponent(v.productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.goto('/checkout');

  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').selectOption('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');

  // انقطاع الشبكة أثناء «احسب الشحن»: رسالة تقول ما حدث لا «Failed to fetch»
  const quote = (url: URL) => url.pathname.endsWith('/checkout/quote');
  await page.route(quote, (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.getByText('لا اتصال بالخادم — تحقّق من الشبكة وأعد المحاولة.')).toBeVisible();
  await expect(page.getByText('Failed to fetch')).toHaveCount(0);
  await page.unroute(quote);

  // حُسب الشحن والحقول ناقصة: الزر لا يعمل، والصفحة تقول ماذا ينقص
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.getByText('أدخل العنوان واحسب الشحن لترى الإجمالي النهائي.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ادفع' })).toBeDisabled();
  await expect(page.getByText('أكمل قبل التأكيد: اسم المستلم، الشارع ورقم البناء، الهاتف.')).toBeVisible();

  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  // الهاتف بأرقام عربية كما تكتبها لوحة الجوال — الخادم يوحّدها ويقبلها
  await page.getByLabel('الهاتف').fill('+٩٦٦٥٠٠٠٠٠٠٠٠');
  await expect(page.getByRole('button', { name: 'ادفع' })).toBeEnabled();
  await page.getByRole('button', { name: 'ادفع' }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByText('تمّ طلبك')).toBeVisible();

  const number = decodeURIComponent(page.url().split('/orders/')[1]!);
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: number } });
  expect((order.shippingAddressSnapshot as { phone: string }).phone).toBe('+966500000000');

  // ملخّص الطلب يعرض الضريبة — بدونها لا يبلغ مجموع الأسطر الإجمالي
  await page.goto(`/account/orders/${encodeURIComponent(number)}`);
  const summary = page.getByRole('complementary', { name: 'ملخّص الدفع' });
  await expect(summary.getByText(/^الضريبة/)).toBeVisible();

  // 4 · الجلسة تموت (رمز التحديث ذهب): الصفحة تعيد إلى الدخول ثم إلى الطلب نفسه
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.setItem('basta.access', 'expired.token.value'));
  await page.goto('/account/orders');
  await page.waitForURL((u) => u.pathname === '/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/account/orders');
});

test('الجلسة الميتة على صفحة عامة لا تنتزع المتصفّح إلى الدخول', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.setItem('basta.access', 'expired.token.value'));
  await page.goto('/');
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).pathname).toBe('/');
});
