import { expect, test } from '@playwright/test';
import { API, PASSWORD, register, tag } from './fixtures';

/**
 * ثغرة XSS لا تصير سرقة جلسة شهر:
 * - رمز التحديث كوكي HttpOnly — لا في localStorage ولا في document.cookie؛
 *   رمز الوصول وحده (ربع ساعة) في متناول السكربت.
 * - سياسة المحتوى بـ nonce لكل طلب بلا 'unsafe-inline' للسكربت: HTML محقون
 *   بمعالج حدث لا ينفّذ.
 */

test('سياسة المحتوى: nonce جديد لكل طلب، والسكربت المحقون في HTML لا يعمل', async ({ page, request }) => {
  const policies = await Promise.all([request.get('/login'), request.get('/login')]).then((rs) =>
    rs.map((r) => r.headers()['content-security-policy'] ?? ''),
  );
  const scriptSrc = policies.map((p) => p.split(';').find((d) => d.trim().startsWith('script-src')) ?? '');
  for (const s of scriptSrc) {
    expect(s).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    expect(s).not.toContain("'unsafe-inline'");
  }
  expect(scriptSrc[0]).not.toBe(scriptSrc[1]);

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'دخول' })).toBeEnabled();
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (d: string) => violations.push(d));
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (e) => (window as never as { reportViolation: (d: string) => void }).reportViolation(e.violatedDirective));
    document.body.insertAdjacentHTML('beforeend', '<img src="/missing.png" onerror="window.__xss = 1">');
  });
  await expect.poll(() => violations).toContain('script-src-attr');
  expect(await page.evaluate(() => (window as never as { __xss?: number }).__xss)).toBeUndefined();
});

test('رمز التحديث كوكي HttpOnly لا يراه السكربت، وتجديد الجلسة يعمل به', async ({ page, context }) => {
  const t = tag();
  const email = `session.${t}@basta.test`;
  await register(email, `مشترٍ ${t}`);

  await page.goto('/login?next=/account');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/account');

  // السكربت يرى رمز الوصول وحده
  const seen = await page.evaluate(() => ({ keys: Object.keys(localStorage), cookie: document.cookie }));
  expect(seen.keys).toContain('basta.access');
  expect(seen.keys).not.toContain('basta.refresh');
  expect(seen.cookie).not.toContain('basta_rt');
  const cookie = (await context.cookies(`${API}/auth/refresh`)).find((c) => c.name === 'basta_rt');
  expect(cookie, 'الكوكي محفوظ في المتصفّح').toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe('Strict');
  expect(cookie!.path).toBe('/api/v1/auth');

  // رمز وصول منتهٍ: الطلب يرتدّ 401 فيتجدّد بالكوكي وحده، والصفحة تكمل
  await page.evaluate(() => localStorage.setItem('basta.access', 'expired.token.value'));
  const account = page.waitForResponse((r) => r.url().endsWith('/me/account') && r.status() === 200);
  await page.reload();
  await account;
  const renewed = await page.evaluate(() => localStorage.getItem('basta.access'));
  expect(renewed).not.toBe('expired.token.value');
  const rotated = (await context.cookies(`${API}/auth/refresh`)).find((c) => c.name === 'basta_rt');
  expect(rotated!.value).not.toBe(cookie!.value);
});
