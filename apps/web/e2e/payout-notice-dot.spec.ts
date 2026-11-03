import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, tag } from './fixtures';

/**
 * «أُرسل طلب سحب 190.00 ر.س.. يُخصم…» — اختصار العملة ينتهي بنقطته، ونقطة الجملة بعده تصير نقطتين
 * (VOPS-079، 29 أكتوبر 2026). المحفظة والطلب من ردّ مُعترَض: لا رصيد حقيقيّ يُصنع لاختبار جملة.
 */
test('رسالة طلب السحب بنقطة واحدة بعد «ر.س.»', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await page.route(/\/api\/v1\/vendor\/finance\/wallets(\?.*)?$/, (route) =>
    route.fulfill({
      json: [{ currency: 'SAR', pendingMinorUnits: '0', availableMinorUnits: '20600', withdrawnMinorUnits: '0', nextReleaseAt: null, canWithdraw: true, minPayoutMinorUnits: '18750' }],
    }),
  );
  await page.route(/\/api\/v1\/vendor\/finance\/payouts(\?.*)?$/, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 201, json: { id: 'payout-e2e' } }) : route.fulfill({ json: { items: [], total: 0 } }),
  );

  await page.goto('/login?next=/vendor/finance');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/finance');

  await page.getByLabel('المبلغ المطلوب (SAR)').fill('190');
  await page.getByRole('button', { name: 'اطلب السحب' }).click();
  const notice = page.getByText(/أُرسل طلب سحب/);
  await expect(notice).toBeVisible();
  const text = (await notice.textContent()) ?? '';
  // علامات الاتجاه حول المبلغ لا تُحسب، والمسافة قبل العملة غير قابلة للكسر — النقطة بعدها هي ما يُرى
  const shown = text.replace(/[\u200e\u200f\u061c]/g, '').replace(/\u00a0/g, ' ');
  expect(shown).toContain('190.00 ر.س. يُخصم');
  expect(shown).not.toContain('ر.س..');
});
