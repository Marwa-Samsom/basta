import { expect, test, type Page } from '@playwright/test';

/**
 * اسم المتجر بالإنجليزية إجباري — قرار صاحبة المشروع، 3 نوفمبر 2026: «بدي تخليلي الاسم بلغة الإنجليزية
 * اجباري مش اختياري». كان «· اختياري» والتسجيل يمرّ بدونه، فيُشتقّ الرابط من الاسم العربي حرفياً.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — اختبارات الدخول تأكل حدّ المحاولات الذي تجرّب
 * به صاحبة المشروع على الخادم نفسه. ورفض الخادم نفسه في vendors.integration.
 */

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-buyer', roles: ['customer'], permissions: [] })}.x`;
};

/** حساب بلا متجر بعد على «بيانات متجرك» */
async function freshSignup(page: Page): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-buyer', roles: ['customer'], permissions: [] } }));
  await page.route('**/api/v1/me/**', (r) => r.fulfill({ json: { unread: 0, items: [], ids: [] } }));
  await page.route('**/api/v1/vendor/onboarding', (r) =>
    r.fulfill({ status: 404, json: { statusCode: 404, code: 'NOT_FOUND', message: 'لا متجر لهذا الحساب.' } }),
  );
  await page.route('**/api/v1/vendor/onboarding/slug-available?*', (r) => {
    const value = new URL(r.request().url()).searchParams.get('value') ?? '';
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
    r.fulfill({ json: { slug, available: true, suggestion: slug } });
  });
  await page.goto('/vendor/register');
  await expect(page.getByRole('heading', { name: 'بيانات المتجر', exact: true })).toBeVisible();
}

test('«اسم المتجر بالإنجليزية» إجباري: بلا «اختياري»، والتالي معطّل بدونه أو بحروف عربية', async ({ page }) => {
  await freshSignup(page);
  const english = page.getByLabel('اسم المتجر بالإنجليزية');
  const next = page.getByRole('button', { name: 'التالي: عملة التسوية' });

  await expect(page.locator('label', { hasText: 'اسم المتجر بالإنجليزية' })).not.toContainText('اختياري');
  await expect(english).toHaveAttribute('required', '');

  await page.getByLabel('اسم المتجر بالعربية').fill('متجر التلميح');
  await expect(next).toBeDisabled();

  await english.fill('متجر التلميح');
  await expect(page.getByText('اكتبه بحروف إنجليزية — منه يُولَّد رابط المتجر.')).toBeVisible();
  await expect(next).toBeDisabled();

  await english.fill('Hint Store');
  await expect(page.getByText('اكتبه بحروف إنجليزية — منه يُولَّد رابط المتجر.')).toHaveCount(0);
  await expect(next).toBeEnabled();
});
