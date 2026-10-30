import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * وثيقة رُفضت والطلب قيد المراجعة: بطاقتها تقول «ارفعها من جديد» وكان زرّ «استبدل» مقفلاً
 * (ADM-030، 30 أكتوبر 2026). المرفوضة وحدها تُستبدل فتعود إلى المراجعة، وغيرها يبقى مقفلاً.
 */
test('الوثيقة المرفوضة تُستبدل والطلب قيد المراجعة، وغيرها مقفل', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'in_review', approvedAt: null, submittedAt: new Date() } });
  await prisma.vendorDocument.createMany({
    data: ['commercial_register', 'national_id', 'tax_card', 'bank_proof'].map((type) => ({
      vendorId: v.vendorId,
      type,
      fileKey: `${v.vendorId}/${type}/e2e`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      originalName: `${type}.pdf`,
      status: type === 'commercial_register' ? 'rejected' : 'pending',
      rejectReason: type === 'commercial_register' ? 'الصورة غير واضحة' : null,
    })),
  });

  try {
    await page.goto('/login?next=/vendor/onboarding/documents');
    await page.getByLabel('البريد الإلكتروني').fill(v.email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForURL((u) => u.pathname === '/vendor/onboarding/documents');

    const rejected = page.getByRole('region', { name: 'السجل التجاري' });
    await expect(rejected.getByText('الصورة غير واضحة — ارفعها من جديد.')).toBeVisible();
    await expect(rejected.getByRole('button', { name: 'استبدل' })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'الهوية الشخصية' }).getByRole('button', { name: 'استبدل' })).toBeDisabled();

    await rejected.getByLabel('ملف السجل التجاري').setInputFiles({
      name: 'سجل-واضح.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.7\n${' '.repeat(64)}`),
    });
    await expect(page.getByText('رُفعت السجل التجاري.')).toBeVisible();
    // عادت «بانتظار المراجعة» فأُقفلت كغيرها
    await expect(rejected.getByRole('button', { name: 'استبدل' })).toBeDisabled();
  } finally {
    // قاعدة التطوير مشتركة: متجر الاختبار لا يبقى في دليل المتاجر
    await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });
  }
});
