import { expect, test, type Page } from '@playwright/test';

/**
 * تلميح زرّ «اختر …» في خطوة العملة — VON-019، 3 نوفمبر 2026. رأت صاحبة المشروع بمتجر اختار عملته من قبل
 * الزرّ معطّلاً و«فهمت» غير معلّمة، والتلميح «اخترت ريال سعودي من قبل — …» لا يقول لماذا: «علّم «فهمت»
 * لتتابع.» كان لمن لم يختر بعد وحده.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وحالة التأهيل مزيّفة — اختبارات الدخول تأكل حدّ المحاولات الذي تجرّب
 * به صاحبة المشروع على الخادم نفسه.
 */

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-seller', roles: ['customer', 'vendor'], permissions: [] })}.x`;
};

/** مسوّدة على خطوة العملة، عملتها ريال سعودي — اختارها صاحبها أو اقترحها البلد */
async function draftAt(page: Page, chosen: boolean): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-seller', roles: ['customer', 'vendor'], permissions: [] } }));
  await page.route('**/api/v1/me/**', (r) => r.fulfill({ json: { unread: 0, items: [], ids: [] } }));
  await page.route('**/api/v1/vendor/onboarding', (r) =>
    r.fulfill({
      json: {
        id: 'e2e-vendor', slug: 'e2e-draft', nameAr: 'متجر المسوّدة', nameEn: null, country: 'SA', businessType: null,
        status: 'pending', rejectionReason: null, submittedAt: null, approvedAt: null,
        settlementCurrency: 'SAR', settlementCurrencyLocked: false, settlementCurrencyChosen: chosen,
        descriptionAr: null, descriptionEn: null, shippingPolicyAr: null, returnPolicyAr: null,
        documents: [], bank: null, blockers: [], canSubmit: false,
      },
    }),
  );
  await page.goto('/vendor/onboarding/currency');
  await expect(page.getByRole('heading', { name: 'اختر عملة التسوية' })).toBeVisible();
}

const ACK = 'فهمت أن العملة تُثبَّت عند اعتماد متجري ولا تتغيّر بعده.';

test('اختار من قبل: قبل «فهمت» التلميح يقول لماذا الزرّ معطّل، وبعدها يذكّر بالاختيار السابق', async ({ page }) => {
  await draftAt(page, true);
  const hint = page.locator('.vo-commit__hint');
  const choose = page.getByRole('button', { name: 'اختر ريال سعودي' });

  await expect(choose).toBeDisabled();
  await expect(hint).toHaveText('علّم «فهمت» لتتابع.');

  await page.getByText(ACK).click();
  await expect(choose).toBeEnabled();
  await expect(hint).toHaveText('اخترت ريال سعودي من قبل — تستطيع تغييرها حتى ترسل طلبك.');
});

test('لم يختر بعد: «علّم «فهمت» لتتابع.» ثم «تُسأل مرة واحدة فقط قبل التأكيد.» كما كان', async ({ page }) => {
  await draftAt(page, false);
  const hint = page.locator('.vo-commit__hint');

  await expect(page.getByRole('button', { name: 'اختر ريال سعودي' })).toBeDisabled();
  await expect(hint).toHaveText('علّم «فهمت» لتتابع.');

  await page.getByText(ACK).click();
  await expect(hint).toHaveText('تُسأل مرة واحدة فقط قبل التأكيد.');
});
