import { expect, test, type Page } from '@playwright/test';

/**
 * تنزيل الوثيقة من صفحة الحالة — VON-032، 4 نوفمبر 2026. صفحة المستندات تعد «تستطيع تنزيل الملف من صفحة
 * الحالة.» وبطاقة «الوثائق» هناك كانت تكتب اسم الملف نصّاً: مسار التنزيل يطلب الرمز فلا يصلح رابطاً.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — اختبارات الدخول تأكل حدّ المحاولات الذي تجرّب به
 * صاحبة المشروع على الخادم نفسه.
 */

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-vendor', roles: ['customer', 'vendor_owner'], permissions: [] })}.x`;
};

const DOC_ID = '7b3c1d2e-0000-4a5b-9c8d-000000000032';
const doc = (type: string, label: string, status: string, file: string | null) => ({
  type,
  label,
  uploaded: file !== null,
  status,
  rejectReason: null,
  originalName: file,
  sizeBytes: file ? 1200 : null,
  uploadedAt: file ? '2026-10-28T16:40:00Z' : null,
  downloadPath: file && type === 'national_id' ? `/vendor/onboarding/documents/${DOC_ID}` : file ? `/vendor/onboarding/documents/${type}-id` : null,
});

const ONBOARDING = {
  id: 'e2e-vendor-shop',
  slug: 'cotton-house-e2e',
  nameAr: 'دار القطن والكتان',
  nameEn: 'Cotton House',
  country: 'JO',
  businessType: 'company',
  status: 'in_review',
  rejectionReason: null,
  submittedAt: '2026-10-28T16:49:00Z',
  approvedAt: null,
  settlementCurrency: 'JOD',
  settlementCurrencyLocked: false,
  settlementCurrencyChosen: true,
  descriptionAr: null,
  descriptionEn: null,
  shippingPolicyAr: null,
  returnPolicyAr: null,
  documents: [
    doc('commercial_register', 'السجل التجاري', 'pending', 'image_3.jpg'),
    doc('national_id', 'الهوية الشخصية', 'accepted', 'national_id.pdf'),
    doc('tax_card', 'الشهادة الضريبية', 'pending', 'tax_card.pdf'),
    doc('bank_proof', 'إثبات الحساب البنكي', 'missing', null),
  ],
  bank: null,
  blockers: [],
  canSubmit: false,
};

async function statusAs(page: Page, file: (auth: string | undefined) => { status: number; body: Buffer | string; type: string }) {
  const asked: (string | undefined)[] = [];
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-vendor', roles: ['customer', 'vendor_owner'], permissions: [] } }));
  await page.route('**/api/v1/me/notifications*', (r) => r.fulfill({ json: { unread: 0, items: [] } }));
  await page.route('**/api/v1/vendor/onboarding', (r) => r.fulfill({ json: ONBOARDING }));
  await page.route(`**/api/v1/vendor/onboarding/documents/${DOC_ID}`, (r) => {
    const auth = r.request().headers()['authorization'];
    asked.push(auth);
    const { status, body, type } = file(auth);
    return r.fulfill({ status, body, contentType: type });
  });
  await page.goto('/vendor/onboarding/status');
  await expect(page.getByRole('heading', { level: 1, name: 'طلبك قيد المراجعة' })).toBeVisible();
  return asked;
}

test('صفحة الحالة: «نزّل» بجانب كل ملف مرفوع، يجلبه بالرمز ويحفظه باسمه الأصلي', async ({ page }) => {
  const pdf = Buffer.from('%PDF-1.4\n% e2e\n');
  const asked = await statusAs(page, () => ({ status: 200, body: pdf, type: 'application/pdf' }));

  const docs = page.getByRole('list').filter({ hasText: 'الهوية الشخصية' });
  // ثلاثة مرفوعة ← ثلاثة أزرار، و«إثبات الحساب البنكي» لم يُرفع فلا زرّ له
  await expect(docs.getByRole('button', { name: /^نزّل/ })).toHaveCount(3);
  await expect(docs.getByRole('button', { name: 'نزّل إثبات الحساب البنكي' })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await docs.getByRole('button', { name: 'نزّل الهوية الشخصية' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('national_id.pdf');
  expect(asked).toEqual([expect.stringMatching(/^Bearer /)]);
});

test('تنزيل رفضه الخادم: السبب بجانب الملف لا صمت', async ({ page }) => {
  await statusAs(page, () => ({ status: 404, body: JSON.stringify({ statusCode: 404, code: 'NOT_FOUND', message: 'الوثيقة غير موجودة.' }), type: 'application/json' }));
  await page.getByRole('button', { name: 'نزّل الهوية الشخصية' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'الوثيقة غير موجودة.' })).toBeVisible();
});
