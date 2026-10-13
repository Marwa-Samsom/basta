import { expect, test, type Page } from '@playwright/test';
import { API, PASSWORD, prisma, register, tag } from './fixtures';

/**
 * عملة التسوية يختارها البائع قبل الإرسال — لا تُفرض عليه.
 *
 * كانت تُقترح من البلد بصمت ويثبّتها الاعتماد، وصفحة الاختيار لا يصلها رابط قبل
 * الإرسال: بائع من قطر يُسعَّر بالدولار ويُقال له «راسل الدعم». الآن العملة خطوة
 * بين بيانات المتجر والمستندات، والإرسال ممنوع بلا اختيار صريح.
 */

async function signIn(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === next);
}

test('بائع من قطر: بعد بيانات المتجر يختار عملته (ريال سعودي لا الدولار المقترح)، ثم المستندات', async ({ page }) => {
  const t = tag();
  const email = `seller.${t}@basta.test`;
  const userId = await register(email, `بائع ${t}`);
  await signIn(page, email, '/vendor/register');

  await page.getByLabel('اسم المتجر بالعربية').fill(`متجر الدوحة ${t}`);
  await page.getByLabel('اسم المتجر بالإنجليزية').fill(`Doha Store ${t}`);
  await page.getByLabel('البلد').selectOption('QA');
  await page.getByRole('button', { name: 'التالي: عملة التسوية' }).click();

  // الخطوة الثالثة، والمقترح من البلد معروض مختاراً لا مفروضاً
  await page.waitForURL((u) => u.pathname === '/vendor/onboarding/currency');
  await expect(page.getByRole('heading', { name: 'اختر عملة التسوية' })).toBeVisible();
  await expect(page.getByRole('button', { name: /USD/ })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /SAR/ }).click();
  await page.getByText('فهمت أن العملة تُثبَّت عند اعتماد متجري ولا تتغيّر بعده.').click();
  await page.getByRole('button', { name: 'اختر ريال سعودي' }).click();
  await page.getByRole('button', { name: 'نعم، وتابع إلى المستندات' }).click();

  await page.waitForURL((u) => u.pathname === '/vendor/onboarding/documents');
  await expect(page.getByText(/عملة التسوية:\s*ريال سعودي/)).toBeVisible();
  const vendor = await prisma.vendor.findFirstOrThrow({ where: { ownerUserId: userId } });
  expect(vendor.settlementCurrency).toBe('SAR');
  expect(vendor.settlementCurrencyChosenAt).not.toBeNull();
  // اختيار لا تثبيت: يتغيّر حتى الإرسال، والاعتماد يثبّته
  expect(vendor.settlementCurrencyLockedAt).toBeNull();
});

test('من تخطّى خطوة العملة: الإرسال ممنوع بمانعها، ورابطه يعيده إليها', async ({ page }) => {
  const t = tag();
  const email = `skipper.${t}@basta.test`;
  await register(email, `بائع ${t}`);
  await signIn(page, email, '/vendor/register');
  // يسجّل المتجر من الواجهة البرمجية بلا عملة — كمن فتح المستندات مباشرةً
  const access = await page.evaluate(() => localStorage.getItem('basta.access'));
  const applied = await fetch(`${API}/vendor/onboarding/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ nameAr: `متجر بلا عملة ${t}`, country: 'JO' }),
  });
  expect(applied.status).toBe(201);
  await page.evaluate((token) => localStorage.setItem('basta.access', token), (await applied.json()).tokens.accessToken as string);

  await page.goto('/vendor/onboarding/documents');
  await expect(page.getByText('اختر عملة التسوية — تُسعَّر بها منتجاتك وتُحوَّل بها مستحقاتك')).toBeVisible();
  await expect(page.getByRole('button', { name: 'أرسل للمراجعة' })).toBeDisabled();
  await page.getByRole('button', { name: 'عملة التسوية', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/onboarding/currency');
});
