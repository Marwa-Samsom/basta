import { expect, test } from '@playwright/test';

/**
 * جواب العملة في أسئلة «بِع على بسطة» — VON-002، 3 نوفمبر 2026. رأت صاحبة المشروع «تختار عملة تسوية واحدة
 * بعد قبول متجرك» والتسجيل يطلبها قبل إرسال الطلب: الخادم يمنع الإرسال بلا اختيار، وتتغيّر حتى الإرسال،
 * والاعتماد يثبّتها. فالجواب يعد البائع بخطوة غير موجودة بعد القبول.
 */
const QUESTION = { ar: 'بأي عملة أُسعّر وأقبض؟', en: 'Which currency do I price and get paid in?' };

for (const locale of ['ar', 'en'] as const) {
  test(`جواب العملة يقول إنها تُختار في التسجيل ويثبّتها الاعتماد (${locale})`, async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'basta.lang', value: locale, url: baseURL! }]);
    await page.goto('/sell');
    const item = page.locator('details.sx-faq__item', { hasText: QUESTION[locale] });
    await item.locator('summary').click();
    const answer = item.locator('.sx-faq__a');
    await expect(answer).toBeVisible();

    if (locale === 'ar') {
      await expect(answer).toContainText('أثناء التسجيل');
      await expect(answer).toContainText('تستطيع تغييرها حتى ترسل طلبك');
      await expect(answer).toContainText('يثبّتها اعتماد متجرك');
      await expect(answer).not.toContainText('بعد قبول متجرك');
    } else {
      await expect(answer).toContainText('during sign-up');
      await expect(answer).toContainText('you can change it until you submit your application');
      await expect(answer).toContainText('approval of your shop locks it');
      await expect(answer).not.toContainText('after your shop is approved');
    }
  });
}
