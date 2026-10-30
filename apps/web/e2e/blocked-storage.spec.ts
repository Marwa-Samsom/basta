import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeVendor, tag } from './fixtures';

/**
 * متصفّح يحجب بيانات الموقع — DISC-002، 29 أكتوبر 2026. لمس localStorage أو sessionStorage
 * فيه يرمي SecurityError، فكان المتجر واللوحتان يسقطون إلى «حدث خلل غير متوقّع»: رمز
 * الدخول ورمز السلة يُقرآن بلا حماية عند رسم الجرس وزرّ السلة. الآن يعمل الموقع: الوضع
 * يتغيّر ولا يُحفظ، والدخول والسلة يبقيان في ذاكرة التبويب حتى إعادة التحميل.
 */
const blockStorage = (page: Page) =>
  page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException('Access is denied for this document.', 'SecurityError');
        },
      });
    }
  });

const CRASH = 'حدث خلل غير متوقّع';

test.use({ colorScheme: 'light' });

test('التخزين المحجوب: المتجر يعمل، والوضع يتغيّر ولا يُحفظ، والسلة تبقى في التبويب', async ({ page }) => {
  const v = await makeVendor(tag());
  await blockStorage(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'الوضع الداكن' })).toBeVisible();
  await expect(page.getByText(CRASH)).toHaveCount(0);

  await page.getByRole('button', { name: 'الوضع الداكن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'الوضع الفاتح' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'الوضع الداكن' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');

  await page.goto(`/p/${v.productSlug}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByText('أُضيف إلى سلّتك.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'السلة — 1' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  await expect(page.getByText(v.productName).first()).toBeVisible();
  await expect(page.getByText('سلّتك فارغة')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('التخزين المحجوب: الدخول يفتح لوحة البائع بجرسها بلا صفحة خطأ', async ({ page }) => {
  const v = await makeVendor(tag());
  await blockStorage(page);

  await page.goto('/login?next=/vendor');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor');
  await expect(page.getByRole('button', { name: 'الوضع الداكن' })).toBeVisible();
  await expect(page.getByText(CRASH)).toHaveCount(0);
});
