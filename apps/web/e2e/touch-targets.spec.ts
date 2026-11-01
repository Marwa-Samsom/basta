import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeVendor, tag } from './fixtures';

/**
 * أهداف اللمس 44 بكسل على الأقل على الجوال — SYS-081، 1 نوفمبر 2026. قاستها صاحبة المشروع
 * على 400 × 800: أيقونات رأس المتجر 40، و«ابحث» 36، و✕ مسح البحث 30، و«كل المتاجر» ورقائق
 * المتاجر 32، والشعار 29؛ وفي اللوحات أيقونات الشريط 32 وتبويبات حالات الطلب 32.
 */
const TOUCH = 44;

/** أهداف الصفحة الأصغر من 44 — اسم كلٍّ ومقاسه، فيقول الفشل أيّها */
const tooSmall = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll(
    (els, min) =>
      els.flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        if (r.width >= min && r.height >= min) return [];
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || el.className;
        return [`${name.trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`];
      }),
    TOUCH,
  );

test.use({ viewport: { width: 400, height: 800 } });

test('رأس المتجر: الشعار والأيقونات والعملة و«ابحث» وزرّ مسحه ورقائق المتاجر 44 فأكثر', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.store__brand')).toBeVisible();
  await page.locator('.search__input').fill('قميص');
  await expect(page.locator('.search__clear')).toBeVisible();

  expect(
    await tooSmall(page, '.store__brand, .store__tools .icon-btn, .store__tools .cur-pick, .search__go, .search__clear, .store__all, .store__cat'),
  ).toEqual([]);
});

test('شريط اللوحة وتبويبات حالات الطلب عند البائع 44 فأكثر', async ({ page }) => {
  const v = await makeVendor(tag());
  await page.goto('/login?next=/vendor/orders');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/orders');
  await expect(page.getByRole('tab').first()).toBeVisible();

  expect(await tooSmall(page, '.dash__bar .icon-btn, .tabs__tab')).toEqual([]);
});
