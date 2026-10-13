import { expect, test } from '@playwright/test';
import { PASSWORD, register, tag } from './fixtures';

/**
 * إعادة التوجيه المفتوحة: رابط دخول مصنوع `?next=…` لا يُخرج المستخدم من الموقع
 * بعد أن يُدخل كلمة مروره — وإلا صارت صفحة دخولنا طُعماً لصفحة تصيّد تشبهها.
 * كل حالة هنا يفتحها المتصفح موقعاً آخر لو مُرِّرت إلى router.push كما هي.
 */
const CRAFTED = ['https://evil.example', '//evil.example', '/\t/evil.example', '/\\evil.example'];

test('رابط الدخول المصنوع يبقى في الموقع بعد الدخول', async ({ page, baseURL }) => {
  const t = tag();
  const email = `redirect.${t}@basta.test`;
  await register(email, `مشترٍ ${t}`);
  const home = new URL(baseURL!).host;
  // الموقع الآخر لا وجود له: يُجاب محلياً فيفشل الاختبار بالتأكيد لا بخطأ شبكة
  await page.route((url) => url.hostname === 'evil.example', (route) => route.fulfill({ body: 'صفحة تصيّد' }));

  for (const next of CRAFTED) {
    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();
    // الوجهة المصنوعة تُسقط فيصل المشتري بيته (حسابه) — لا الموقع الآخر
    await page.waitForURL((u) => u.pathname === '/account' || u.host !== home);
    expect(new URL(page.url()).host, JSON.stringify(next)).toBe(home);
    expect(new URL(page.url()).pathname).toBe('/account');
  }
});
