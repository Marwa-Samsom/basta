import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeAdmin, tag } from './fixtures';

/**
 * لوحة الإدارة تتّسع لشاشتها — ADM-015 و ADM-019، 29–30 أكتوبر 2026 (الموجة 4 · واجهة).
 * وجدتها صاحبة المشروع على 1280 × 600 و 375: المبلغ في بطاقات المؤشرات ينقسم بين سطرين
 * («د» ثم «أ.»، وعلى الجوال «263,461.1» ثم «07»)، وجدولا «مستخدمو الإدارة» و«سجلّ التدقيق»
 * أعرض من مكانهما فيُقصّ آخر عمود، وخانات الإعدادات تركب أسماءها على الجوال ورقم الحساب
 * (IBAN) مقصوص.
 */
const ALL = [
  'vendors.review', 'catalog.manage', 'orders.manage', 'orders.cancel', 'disputes.resolve', 'payouts.approve', 'commissions.edit',
  'coupons.manage', 'content.manage', 'customers.manage', 'settings.edit', 'reports.view', 'audit.view', 'users.manage',
];

async function signInAdmin(page: Page): Promise<void> {
  const admin = await makeAdmin(tag(), ALL);
  await page.goto('/login?next=/admin');
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin');
}

/**
 * بطاقات المال التي ينقسم فيها الرقم أو رمز عملته بين سطرين — كلٌّ منهما سطر واحد دائماً،
 * والرمز وحده ينزل تحت الرقم إن ضاقت البطاقة.
 */
const splitMoney = (page: Page) =>
  page.locator('.ao-metric__value.money').evaluateAll((els) =>
    els.flatMap((el) => {
      const node = el.firstChild;
      const text = (node?.textContent ?? '').replace(/[\u200e\u200f]+$/, '');
      const at = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\u00a0'));
      if (!node || at < 0) return [];
      const lines = (from: number, to: number) => {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      };
      return lines(0, at) === 1 && lines(at + 1, text.length) === 1 ? [] : [text];
    }),
  );

/** عرض الجدول الزائد على مكانه بالبكسل — صفر حين يتّسع */
const tableOverflow = (page: Page) =>
  page.locator('.table-wrap').first().evaluate((el) => el.scrollWidth - el.clientWidth);

test('المبلغ لا ينقسم على 1280 ولا على الجوال، والجدولان يتّسعان على 1280 بلا قصّ', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await signInAdmin(page);

  await expect(page.getByRole('heading', { name: 'لوحة المؤشرات', level: 1 })).toBeVisible();
  expect.soft(await splitMoney(page), 'مبلغ على سطرين — 1280').toEqual([]);

  for (const path of ['/admin/users', '/admin/audit']) {
    await page.goto(path);
    await expect(page.locator('.table tbody tr').first()).toBeVisible();
    expect.soft(await tableOverflow(page), path).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'لوحة المؤشرات', level: 1 })).toBeVisible();
  expect.soft(await splitMoney(page), 'مبلغ على سطرين — 375').toEqual([]);
});

test('الإعدادات: رقم الحساب ظاهر كاملاً، وعلى الجوال لا يركب حقلٌ اسمَ إعداده و«حفظ» بجانبه', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await signInAdmin(page);
  await page.goto('/admin/settings');

  const iban = page.locator('.ac2-setting').filter({ hasText: 'transfer_iban' }).locator('input');
  await expect(iban).toBeVisible();
  await iban.fill('JO94CBJO0010000000000131000302');
  expect.soft(await iban.evaluate((el) => el.scrollWidth - el.clientWidth), 'IBAN مقصوص').toBeLessThanOrEqual(1);
  await page.reload();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.ac2-setting').first()).toBeVisible();
  const overlaps = await page.locator('.ac2-setting__row').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const control = row.querySelector('input, select')?.getBoundingClientRect();
      if (!control) return [];
      // حدود النصّ نفسه لا صندوقه: الرمز الطويل كان يفيض من صندوقه تحت الحقل
      return [...row.querySelectorAll('.ac2-setting__name, .ac2-setting__key')].flatMap((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const apart = text.right <= control.left || control.right <= text.left || text.bottom <= control.top || control.bottom <= text.top;
        return apart ? [] : [el.textContent ?? ''];
      });
    }),
  );
  expect.soft(overlaps).toEqual([]);

  // «حفظ» في سطر حقله لا وحده تحته
  const ibanRow = page.locator('.ac2-setting').filter({ hasText: 'transfer_iban' });
  const [field, save] = await Promise.all([ibanRow.locator('input').boundingBox(), ibanRow.getByRole('button', { name: 'حفظ' }).boundingBox()]);
  expect.soft(save && field && save.y < field.y + field.height, '«حفظ» تحت الحقل').toBe(true);

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
