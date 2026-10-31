import { expect, test } from '@playwright/test';
import { makeAdmin, PASSWORD, tag } from './fixtures';

/**
 * «كوبون يُعلَن» بحثاً برمزه بدل قائمة بكل الكوبونات المفعّلة (779 على قاعدة التطوير) يُمرَّر فيها
 * (ACFG-039، 31 أكتوبر 2026). الخيارات من ردّ مُعترَض يحاكي بحث الخادم: أوّل عشرين والإجمالي.
 */
test('«كوبون يُعلَن»: بحث برمز الكوبون، والمختار يبقى ظاهراً ولو خرج من النتائج', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['content.manage']);
  const all = Array.from({ length: 30 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    code: `E2E-PICK-${String(i).padStart(2, '0')}`,
    endsAt: null,
  }));
  await page.route(/\/api\/v1\/admin\/campaigns\/coupon-options/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    const hits = all.filter((c) => c.code.toLowerCase().includes(q));
    return route.fulfill({ json: { items: hits.slice(0, 20), total: hits.length } });
  });

  await page.goto(`/login?next=${encodeURIComponent('/admin/campaigns')}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/campaigns');

  await page.getByRole('button', { name: 'حملة جديدة' }).first().click();
  const pick = page.getByRole('combobox', { name: 'كوبون يُعلَن (اختياري)' });
  const search = page.getByLabel('ابحث عن كوبون');
  await expect(pick.locator('option', { hasText: 'أوّل 20 من 30 — ضيّق بالبحث' })).toHaveCount(1);

  await search.fill('pick-27');
  await expect(pick.locator('option')).toHaveText(['بلا كوبون', 'E2E-PICK-27']);
  await pick.selectOption({ label: 'E2E-PICK-27' });

  // بحث آخر لا يطابقه: يبقى المختار مختاراً وظاهراً
  await search.fill('pick-0');
  await expect(pick.locator('option', { hasText: 'E2E-PICK-03' })).toHaveCount(1);
  await expect(pick).toHaveValue(all[27]!.id);
  await expect(pick.locator('option:checked')).toHaveText('E2E-PICK-27');

  await search.fill('لا-مطابق');
  await expect(pick.locator('option', { hasText: 'لا كوبون مفعّل بهذا الرمز' })).toHaveCount(1);
});
