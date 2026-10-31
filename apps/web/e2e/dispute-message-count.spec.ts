import { expect, test } from '@playwright/test';
import { makeAdmin, PASSWORD, tag } from './fixtures';

/**
 * رسالة الإدارة في نزاع تزيد عدّاد رسائله في القائمة بلا تحديث الصفحة — كان «إرسال» يحدّث المجرى وحده
 * فيبقى «2 رسالة» حتى F5 (ADM-066، 31 أكتوبر 2026). النزاع من ردّ مُعترَض: لا يُصعَّد نزاع حقيقي لعدّاد.
 */
test('«إرسال» في نزاع يزيد عدّاد رسائله في القائمة', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['disputes.resolve']);
  const id = '00000000-0000-4000-8000-0000000000aa';
  const subOrder = {
    id: '00000000-0000-4000-8000-0000000000bb',
    subOrderNumber: 'BST-E2E-DSP-1',
    status: 'delivered',
    vendor: { nameAr: 'متجر النزاع' },
    order: { orderNumber: 'BST-E2E-DSP' },
  };
  const at = new Date().toISOString();
  const messages = [
    { id: 'm1', senderRole: 'customer', body: 'المعطف مش متل الصورة.', createdAt: at },
    { id: 'm2', senderRole: 'vendor_owner', body: 'خرجت الشحنة سليمة.', createdAt: at },
  ];
  await page.route(/\/api\/v1\/admin\/disputes\?/, (route) =>
    route.fulfill({
      json: { items: [{ id, reasonCode: 'not_as_described', status: 'escalated', createdAt: at, subOrder, _count: { messages: messages.length } }], total: 1 },
    }),
  );
  await page.route(new RegExp(`/api/v1/admin/disputes/${id}$`), (route) =>
    route.fulfill({ json: { id, status: 'escalated', reasonCode: 'not_as_described', resolution: null, messages, subOrder } }),
  );
  await page.route(new RegExp(`/api/v1/admin/disputes/${id}/messages$`), async (route) => {
    messages.push({ id: `m${messages.length + 1}`, senderRole: 'admin', body: route.request().postDataJSON().body, createdAt: new Date().toISOString() });
    await route.fulfill({ status: 204 });
  });

  await page.goto(`/login?next=${encodeURIComponent('/admin/disputes')}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/disputes');

  const item = page.getByRole('navigation', { name: 'قائمة النزاعات' }).getByRole('button', { name: /BST-E2E-DSP-1/ });
  await expect(item).toContainText('2 رسالة');
  await page.getByLabel('رسالة للطرفين').fill('راجعنا الصور.');
  await page.getByRole('button', { name: 'إرسال' }).click();
  await expect(page.getByText('راجعنا الصور.')).toBeVisible();
  await expect(item).toContainText('3 رسالة');
});
