import { expect, test } from '@playwright/test';
import { signInBuyer } from './fixtures';

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
