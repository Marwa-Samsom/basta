import { expect, test } from '@playwright/test';
import { signInBuyer, totpNow } from './fixtures';

/**
 * تفعيل التحقق بخطوتين: رمز QR بدل المفتاح السرّي (24 أكتوبر 2026، بطلب صاحبة المشروع).
 * الرمز يُرسم في الصفحة من رابط otpauth نفسه — والرابط باقٍ لمن يفتح الصفحة على هاتفه.
 */
test('تفعيل التحقق: رمز QR يُمسح بدل مفتاح يُنسخ، والرابط باقٍ للهاتف نفسه', async ({ page }) => {
  await signInBuyer(page);
  await page.goto('/account/2fa');
  const qr = page.getByRole('img', { name: 'رمز QR لإضافة الحساب في تطبيق المصادقة' });
  await expect(qr).toBeVisible();
  // ورقة بيضاء بهامش صمت ورسم بالمسار — لا صورة من خدمة خارجية
  await expect(qr.locator('path')).toHaveAttribute('d', /^M4 4h1v1h-1z/);
  await expect(page.getByText('المفتاح السرّي')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'انسخ المفتاح' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'هذا الرابط' })).toHaveAttribute('href', /^otpauth:\/\/totp\//);
});

test('رمز خاطئ يُرسَل مرة واحدة ويُقال تحت الخانة — لا تجديد جلسة ولا إعادة (AUTH-051)', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/auth\/(totp\/confirm|refresh)$/.test(new URL(r.url()).pathname)) sent.push(new URL(r.url()).pathname);
  });
  await signInBuyer(page);
  await page.goto('/account/2fa');
  await expect(page.getByRole('img', { name: 'رمز QR لإضافة الحساب في تطبيق المصادقة' })).toBeVisible();
  sent.length = 0;

  // كان الرفض 401 فتقرؤه الواجهة انتهاء جلسة: refresh ثم confirm ثانية بالرمز نفسه
  await page.getByPlaceholder('000000').fill('654321');
  const answer = page.waitForResponse((r) => r.url().includes('/auth/totp/confirm'));
  await page.getByRole('button', { name: 'تأكيد وتفعيل' }).click();
  expect((await answer).status()).toBe(403);
  await expect(page.getByText('الرمز غير صحيح. تأكد من وقت جهازك وأعد المحاولة.')).toBeVisible();
  expect(sent.filter((p) => p.endsWith('/totp/confirm'))).toHaveLength(1);
  expect(sent.filter((p) => p.endsWith('/refresh'))).toHaveLength(0);
});

test('ما يُمسح يُفعَّل: طلب تهيئة واحد للصفحة، فرمز السرّ المرسوم يقبله الخادم', async ({ page }) => {
  const setups: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/auth/totp/setup')) setups.push(r.url());
  });
  await signInBuyer(page);
  await page.goto('/account/2fa');
  await expect(page.getByRole('img', { name: 'رمز QR لإضافة الحساب في تطبيق المصادقة' })).toBeVisible();
  // وضع React الصارم يشغّل الأثر مرتين: كان طلبان، فيُرسم سرّ ويُحفظ غيره أحياناً ولا يُقبل رمزه
  expect(setups).toHaveLength(1);

  // كما يفعل الهاتف: السرّ من الرابط الذي يحمله الرمز، ورمز التطبيق منه
  const href = await page.getByRole('link', { name: 'هذا الرابط' }).getAttribute('href');
  const secret = new URL(href!).searchParams.get('secret')!;
  await page.getByPlaceholder('000000').fill(totpNow(secret));
  await page.getByRole('button', { name: 'تأكيد وتفعيل' }).click();
  await expect(page.getByText('احفظ هذه الرموز الآن — لن تظهر مرة أخرى')).toBeVisible();
});
