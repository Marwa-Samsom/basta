import { expect, test, type Page } from '@playwright/test';

/**
 * نصوص التاجر من زمن المراجعة قبل النشر — 5 نوفمبر 2026 (ADR-016: يُنشر بلا مراجعة، والإدارة توقف المخالف):
 * - VON-046: «ما يمكنك فعله الآن» وقت المراجعة قالت «جهّز منتجاتك كمسودّات — تستطيع إرسالها للنشر فور اعتماد
 *   متجرك.» وشريط اللوحة يقول «انشرها الآن».
 * - VOPS-068: إشعار الإيقاف عنوانه «لم يُنشر منتجك» (و«أُعيد منتج إليك للتعديل» في صندوق الحساب)، والصندوق
 *   الفارغ يذكر «قرارات المراجعة».
 * - VON-041: المسوّدة في صفحتي العملة والمستندات بلا طريق إلى صفحة الحالة.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — اختبارات الدخول تأكل حدّ المحاولات الذي تجرّب به
 * صاحبة المشروع على الخادم نفسه.
 */

const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-vendor', roles: ['customer', 'vendor_owner'], permissions: [] })}.x`;
};

const doc = (type: string, label: string) => ({
  type, label, uploaded: false, status: 'missing', rejectReason: null, originalName: null, sizeBytes: null, uploadedAt: null, downloadPath: null,
});

const onboarding = (status: 'pending' | 'in_review') => ({
  id: 'e2e-vendor-shop', slug: 'riyadh-e2e', nameAr: 'متجر الرياض', nameEn: 'Riyadh Shop', country: 'SA', businessType: 'company',
  status, rejectionReason: null, submittedAt: status === 'in_review' ? '2026-11-05T10:00:00Z' : null, approvedAt: null,
  settlementCurrency: 'SAR', settlementCurrencyLocked: status === 'in_review', settlementCurrencyChosen: true,
  descriptionAr: null, descriptionEn: null, shippingPolicyAr: null, returnPolicyAr: null,
  documents: [doc('commercial_register', 'السجل التجاري'), doc('national_id', 'الهوية الشخصية'), doc('tax_card', 'الشهادة الضريبية'), doc('bank_proof', 'إثبات الحساب البنكي')],
  bank: null, blockers: [], canSubmit: false,
});

async function vendorAs(page: Page, status: 'pending' | 'in_review' | 'approved', notifications: unknown[] = []) {
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-vendor', roles: ['customer', 'vendor_owner'], permissions: [] } }));
  await page.route('**/api/v1/me/notifications*', (r) =>
    r.fulfill({ json: { unread: notifications.length, items: notifications, nextCursor: null, total: notifications.length, counts: { product_rejected: notifications.length } } }),
  );
  await page.route('**/api/v1/vendor/onboarding', (r) =>
    r.fulfill({ json: status === 'approved' ? { ...onboarding('in_review'), status: 'approved', approvedAt: '2026-11-05T11:00:00Z' } : onboarding(status) }),
  );
}

test('قيد المراجعة: «ما يمكنك فعله الآن» تقول انشرها الآن كشريط اللوحة — لا «كمسودّات»', async ({ page }) => {
  await vendorAs(page, 'in_review');
  await page.goto('/vendor/onboarding/status');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'ما يمكنك فعله الآن' }) });
  await expect(card).toContainText('أضف منتجاتك وانشرها الآن — تظهر للمشترين تلقائياً لحظة اعتماد متجرك.');
  await expect(card).not.toContainText('كمسودّات');
  await expect(card.getByRole('link', { name: 'أضف منتجاتك' })).toHaveAttribute('href', '/vendor/products');
});

test('المسوّدة: «تابع حالة طلبك» من صفحتي العملة والمستندات', async ({ page }) => {
  await vendorAs(page, 'pending');
  await page.goto('/vendor/onboarding/currency');
  await expect(page.getByRole('link', { name: 'تابع حالة طلبك' })).toHaveAttribute('href', '/vendor/onboarding/status');
  await page.goto('/vendor/onboarding/documents');
  await expect(page.getByRole('link', { name: 'تابع حالة طلبك' })).toHaveAttribute('href', '/vendor/onboarding/status');
});

test('إشعار الإيقاف: «أُوقف منتجك» في صندوق اللوحة وصندوق الحساب، والفارغ بلا «قرارات المراجعة»', async ({ page }) => {
  const takedown = { id: 'n1', code: 'product_rejected', body: 'أُوقف عرض «بلوزة»: الصورة لا تُظهر المنتج.', link: '/vendor/products', readAt: null, createdAt: '2026-11-05T12:00:00Z' };
  await vendorAs(page, 'approved', [takedown]);
  await page.goto('/vendor/notifications');
  await expect(page.getByText('أُوقف منتجك').first()).toBeVisible();
  await expect(page.getByText('لم يُنشر منتجك')).toHaveCount(0);
  await page.goto('/account/notifications');
  await expect(page.getByText('أُوقف منتجك').first()).toBeVisible();
  await expect(page.getByText('أُعيد منتج إليك للتعديل')).toHaveCount(0);
});

test('صندوق إشعارات اللوحة الفارغ: الطلبات وإيقاف المنتجات وتنبيهات المخزون', async ({ page }) => {
  await vendorAs(page, 'approved');
  await page.goto('/vendor/notifications');
  await expect(page.getByText('كل شيء هادئ. الطلبات الجديدة وإيقاف المنتجات وتنبيهات المخزون تظهر هنا.')).toBeVisible();
});
