import { expect, test } from '@playwright/test';
import { prisma, signInBuyer, tag } from './fixtures';

/**
 * فتح الجرس يجلب الجديد. القائمة تُسأل كل دقيقة، فإشعار وصل بعد آخر سؤال كان يغيب حتى الدورة التالية:
 * فتحت صاحبة المتجر الجرس بعد طلب الإرجاع فلم تجده (VOPS-040، 29 أكتوبر 2026).
 */
test('إشعار وصل بعد تحميل الصفحة يظهر عند فتح الجرس — لا بعد دقيقة', async ({ page }) => {
  const t = tag();
  const { userId } = await signInBuyer(page, t);
  // الصفحة استقرّت وسأل الجرس سؤاله الأول — وما يصل بعده ينتظر الدورة التالية
  await page.waitForLoadState('networkidle');

  const body = `إشعار وصل للتوّ ${t}`;
  const note = await prisma.notification.create({
    data: { userId, channel: 'in_app', templateCode: 'order_status_changed', payloadJson: { link: '/account/orders' }, status: 'sent', body, sentAt: new Date() },
  });
  try {
    await page.getByRole('button', { name: /^الإشعارات/ }).click();
    // أقل بكثير من دقيقة السؤال الدوري
    await expect(page.locator('.bell__panel')).toContainText(body, { timeout: 5_000 });
  } finally {
    await prisma.notification.delete({ where: { id: note.id } });
  }
});
