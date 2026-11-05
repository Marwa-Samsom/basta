import { expect, test, type Page } from '@playwright/test';

/**
 * «نسبة لمتجر» — ACFG-014، 4 نوفمبر 2026. القائمة كانت من طابور المراجعة (‎/admin/vendors?status=approved‎):
 * مدير العمولات وحدها بقي على «…» بلا سبب، و«دار القطن والكتان» قيد المراجعة — وهو ينشر قبل اعتماده —
 * «لا متجر معتمد بهذا البحث». الآن من مسار العمولة نفسه، كل متجر أرسل طلبه إلا المحظور بحالته ورابطه —
 * الرابط يفرّق متجرين بالاسم نفسه (كانت 43 مسوّدة «دار القطن والكتان» حول الحقيقي، 5 نوفمبر 2026).
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — المدير بتحقّق ثنائي، واختبارات الدخول تأكل حدّ
 * المحاولات الذي تجرّب به صاحبة المشروع على الخادم نفسه.
 */

const PERMS = ['commissions.edit'];

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-admin', roles: ['admin'], permissions: PERMS })}.x`;
};

const GLOBAL = { id: 'g', scope: 'global', vendorId: null, rateBps: 1000, effectiveFrom: '2026-11-03T10:52:00Z', effectiveTo: null, vendor: null };

/** العمولة بمدير العمولات وحدها: كل طلب لقائمة المتاجر يُحفظ، وطابور المراجعة مرفوض كما في الخادم */
async function commissionsAs(page: Page, vendors: (q: URLSearchParams) => { status?: number; json: unknown }) {
  const asked: string[] = [];
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-admin', roles: ['admin'], permissions: PERMS } }));
  await page.route('**/api/v1/me/notifications*', (r) => r.fulfill({ json: { unread: 0, items: [] } }));
  await page.route('**/api/v1/admin/finance/commissions?*', (r) => r.fulfill({ json: { global: GLOBAL, items: [], total: 0, counts: { vendor: 0 } } }));
  await page.route('**/api/v1/admin/finance/commissions/vendors?*', (r) => {
    asked.push(r.request().url());
    const { status = 200, json } = vendors(new URL(r.request().url()).searchParams);
    return r.fulfill({ status, json });
  });
  await page.route('**/api/v1/admin/vendors*', (r) => {
    asked.push(r.request().url());
    return r.fulfill({ status: 403, json: { statusCode: 403, code: 'FORBIDDEN', message: 'لا تحمل صلاحية مراجعة المتاجر.' } });
  });
  await page.goto('/admin/commissions');
  await page.getByRole('button', { name: /نسبة لمتجر/ }).first().click();
  return asked;
}

test('مدير العمولات وحدها يختار متجراً قيد المراجعة — بحالته، ومن مسار العمولة لا طابور المراجعة', async ({ page }) => {
  const asked = await commissionsAs(page, (q) =>
    q.get('search')?.includes('القطن')
      ? { json: { items: [{ id: '5f0e8b8e-1111-4c3a-9d44-000000000001', nameAr: 'دار القطن والكتان', slug: 'cotton-house', status: 'in_review' }], total: 1 } }
      : { json: { items: Array.from({ length: 20 }, (_, i) => ({ id: `5f0e8b8e-2222-4c3a-9d44-${String(i).padStart(12, '0')}`, nameAr: `متجر ${i}`, slug: `shop-${i}`, status: 'approved' })), total: 10542 } },
  );
  const pick = page.getByRole('combobox', { name: 'المتجر' });
  await expect(pick.locator('option').first()).toHaveText('اختر من أول 20 من 10542 — أو ضيّق بالبحث');
  await expect(pick.locator('option').nth(1)).toHaveText('متجر 0 · shop-0');

  await page.getByRole('searchbox', { name: 'ابحث عن متجر' }).fill('دار القطن');
  await expect(pick.locator('option').nth(1)).toHaveText('دار القطن والكتان — قيد المراجعة · cotton-house');
  await pick.selectOption({ label: 'دار القطن والكتان — قيد المراجعة · cotton-house' });
  await expect(pick).toHaveValue('5f0e8b8e-1111-4c3a-9d44-000000000001');

  expect(asked.filter((u) => u.includes('/admin/vendors')), 'طابور المراجعة').toEqual([]);
  expect(asked.every((u) => !new URL(u).searchParams.has('status')), 'لا تصفية بالحالة').toBe(true);
});

test('رفض الخادم يُكتب في القائمة مكان «…» الذي لا ينتهي', async ({ page }) => {
  await commissionsAs(page, () => ({ status: 403, json: { statusCode: 403, code: 'FORBIDDEN', message: 'لا تحمل صلاحية العمولات.' } }));
  await expect(page.getByRole('combobox', { name: 'المتجر' }).locator('option').first()).toHaveText('لا تحمل صلاحية العمولات.');
});
