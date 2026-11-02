import { expect, test } from '@playwright/test';
import { makeAdmin, PASSWORD, prisma, tag } from './fixtures';

/**
 * العملات وسجلّ الصرف — ACFG-016، 2 نوفمبر 2026. رأت صاحبة المشروع «—» في «السعر مقابل الدولار» للدرهم
 * والدينار الكويتي والجنيه واليورو ولكلٍّ منها سعر: الساري كان يُؤخذ من أحدث 200 سطر في السجلّ، والسجلّ
 * 228 سطراً أغلبها للريال من الاختبارات. وسألت «ليش فش التالي والسابق»: الصفحة كانت تقصّه على 50.
 */
test('الساري لكل عملة مسعَّرة يظهر، والسجلّ بعدّه و«المزيد»', async ({ page }) => {
  // الساري كما يسعّر الدفع: الأحدث قبل اللحظة لكل عملة
  const rows = await prisma.exchangeRate.findMany({
    where: { baseCode: 'USD', effectiveAt: { lte: new Date() } },
    orderBy: { effectiveAt: 'desc' },
    select: { quoteCode: true, rate: true },
  });
  const current = new Map<string, string>();
  for (const r of rows) if (!current.has(r.quoteCode)) current.set(r.quoteCode, r.rate.toString());
  const total = await prisma.exchangeRate.count({ where: { baseCode: 'USD' } });

  const admin = await makeAdmin(tag(), ['settings.edit']);
  await page.goto(`/login?next=${encodeURIComponent('/admin/currencies')}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/currencies');

  const table = page.getByRole('region', { name: 'العملات' });
  for (const [code, rate] of current) {
    if (code === 'USD') continue;
    const row = table.locator('tr', { has: page.locator('.ac2-code', { hasText: new RegExp(`^${code}$`) }) });
    const cell = row.locator('td').last();
    await expect(cell, code).not.toHaveText('—');
    expect(Number(await cell.innerText()), code).toBeCloseTo(Number(rate), 6);
  }

  // السجلّ: عدده كلّه، وخمسون أولاً، و«المزيد» يُلحق التالية
  const history = page.getByRole('region', { name: 'سجلّ أسعار الصرف' });
  const lines = history.locator('tbody tr');
  await expect(lines).toHaveCount(Math.min(50, total));
  if (total > 50) {
    await expect(history.getByText(/سطراً|أسطر|سطر/)).toContainText(String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    await history.getByRole('button', { name: 'المزيد' }).click();
    await expect(lines).toHaveCount(Math.min(100, total));
  }
  // «الساري» مرّة واحدة لكل عملة على الأكثر
  const badges = await history.locator('tr:has(.badge--success) td.num:first-child').allInnerTexts();
  expect(new Set(badges).size).toBe(badges.length);
});
