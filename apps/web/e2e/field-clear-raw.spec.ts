import { expect, type Locator, type Page, test } from '@playwright/test';
import { makeAdmin, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * ✕ في خانات الإدارة والتاجر المكتوبة بلا TextInput — 27 أكتوبر 2026، بطلب صاحبة المشروع.
 * الخانة صارت داخل غلاف، فالمهمّ أن يبقى شكلها: الغلاف بعرض الخانة نفسه، و✕ داخلها في نهاية
 * سطرها. وفي الإعدادات ومصفوفة المتغيّرات (كلها معبّأة) ✕ عند المرور أو الكتابة وحدهما.
 */
async function signIn(page: Page, email: string, next: string, totp?: () => string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  if (totp) {
    await page.getByLabel('رمز التحقق الثنائي').fill(totp());
    await page.getByRole('button', { name: 'دخول' }).click();
  }
  await page.waitForURL((u) => u.pathname === next);
}

const clearOf = (input: Locator) => input.locator('xpath=..').locator('.field__clear');

/** الغلاف بعرض الخانة، و✕ ظاهر داخلها في نهاية سطرها — يميناً لـ ltr ويساراً للعربي */
async function expectClearInside(input: Locator): Promise<void> {
  const g = await input.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const w = el.parentElement!.getBoundingClientRect();
    const x = el.parentElement!.querySelector('.field__clear')!;
    const xr = x.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    return {
      sameBox: Math.abs(r.width - w.width) < 1 && Math.abs(r.left - w.left) < 1,
      inside: xr.left >= r.left && xr.right <= r.right && xr.top >= r.top && xr.bottom <= r.bottom,
      atEnd: rtl ? xr.left - r.left < 12 : r.right - xr.right < 12,
      visible: getComputedStyle(x).visibility === 'visible',
    };
  });
  expect(g).toEqual({ sameBox: true, inside: true, atEnd: true, visible: true });
}

async function fillAndClear(input: Locator, value: string): Promise<void> {
  // خانة تأتي فارغة لا ✕ فيها؛ بعض خانات النماذج تأتي بقيمة مقترحة
  if ((await input.inputValue()) === '') await expect(clearOf(input)).toHaveCount(0);
  await input.fill(value);
  await expectClearInside(input);
  await clearOf(input).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(clearOf(input)).toHaveCount(0);
}

test('الإدارة: الكوبون والخصيصة وسجل التدقيق والإعدادات', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['coupons.manage', 'catalog.manage', 'audit.view', 'settings.edit']);
  await signIn(page, admin.email, '/admin/coupons', admin.totp);

  await page.getByRole('button', { name: 'كوبون جديد' }).first().click();
  const coupon = page.getByRole('region', { name: 'كوبون جديد' });
  await fillAndClear(coupon.getByLabel('الرمز', { exact: true }), 'QA-CLEAR');
  await fillAndClear(coupon.getByLabel('النسبة %', { exact: true }), '15');

  await page.goto('/admin/attributes');
  await page.getByRole('button', { name: 'خصيصة جديدة' }).first().click();
  const attr = page.getByRole('region', { name: 'خصيصة جديدة' });
  await fillAndClear(attr.getByLabel('الاسم', { exact: true }), 'اللون'); // عربي: ✕ يساراً

  await page.goto('/admin/audit');
  await fillAndClear(page.getByLabel('الإجراء', { exact: true }), 'payout.'); // شريط الأدوات: 240 عرضاً

  // الإعدادات معبّأة: ✕ مخفيّ حتى المرور أو التركيز، ثم داخل خانة الرقم قبل وحدتها
  await page.goto('/admin/settings');
  const setting = page.locator('.ac2-unit input').first();
  await expect(setting).not.toHaveValue('');
  await expect(clearOf(setting)).toBeHidden();
  await setting.focus();
  await expectClearInside(setting);
  await clearOf(setting).click();
  await expect(setting).toHaveValue('');
});

test('التاجر: فئة جديدة، ومصفوفة المتغيّرات بـ ✕ عند التركيز وحده', async ({ page }) => {
  const v = await makeVendor(tag());
  await signIn(page, v.email, '/vendor/categories');
  await fillAndClear(page.getByRole('textbox', { name: 'فئة جديدة', exact: true }), 'قمصان صيفية');

  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  await page.goto(`/vendor/products/${product.id}`);
  const sku = page.locator('.vp-matrix input.vp-cell--sku').first();
  await expect(sku).not.toHaveValue('');
  await expect(clearOf(sku)).toBeHidden();
  await sku.focus();
  await expectClearInside(sku);
  await clearOf(sku).click();
  await expect(sku).toHaveValue('');
  await expect(sku).toBeFocused();
});

/**
 * الخانات المركّبة — خانة في إطار معها وحدتها أو بادئتها (28 أكتوبر 2026، بطلب صاحبة المشروع):
 * مبلغ السحب، وأسعار الشحن، ورابط المتجر في التسجيل. ✕ داخل الخانة قبل الوحدة أو الأيقونة.
 */
test('الخانات المركّبة: مبلغ السحب، وقيمة السلّة في الشحن، ورابط المتجر', async ({ page, browser }) => {
  const v = await makeVendor(tag());
  // رصيد متاح ليظهر نموذج السحب — محفظة تجريبية لتاجر الاختبار وحده، تُمحى بعده: رصيد بلا قيد
  // يظهر في لوحة الإدارة «رصيد محفظة لا يطابق دفترها» (قاعدة التطوير نفسها، 28 أكتوبر 2026)
  const wallet = await prisma.wallet.create({ data: { vendorId: v.vendorId, currency: 'SAR', balanceAvailableMinorUnits: 50_000n } });
  try {
    await signIn(page, v.email, '/vendor/finance');
    await fillAndClear(page.getByLabel('المبلغ المطلوب (SAR)', { exact: true }), '120.00');
  } finally {
    await prisma.wallet.delete({ where: { id: wallet.id } });
  }

  await page.goto('/vendor/shipping');
  await fillAndClear(page.getByLabel('قيمة السلّة', { exact: true }), '250');

  // رابط المتجر: لحساب بلا متجر — جلسة مستقلّة
  const buyerPage = await (await browser.newContext()).newPage();
  await signInBuyer(buyerPage);
  await buyerPage.goto('/vendor/register');
  await fillAndClear(buyerPage.getByLabel('رابط المتجر', { exact: true }), 'qa-clear-shop');
});
