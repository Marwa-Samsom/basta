import { expect, test } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * نافذة التأكيد — SYS-096 (J-04، 19 أكتوبر 2026). كانت window.confirm يرسمها المتصفح
 * بلغته: «localhost:3000 says» وزرّا OK و Cancel بالإنجليزية فوق صفحة عربية. الآن نافذة
 * الموقع، وكلماتها الثابتة بلغة الصفحة: عربية على الصفحة العربية، وإنجليزية لو صارت
 * الصفحة إنجليزية — بطلب صاحبة المشروع.
 */
test('حذف فئة يسأل بنافذة الموقع بلغة الصفحة: التراجع لا يحذف، والتأكيد يحذف', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  // الفئة الأولى فيها منتج الاختبار؛ الثانية فارغة فتُحذف
  const [, empty] = await prisma.vendorCategory.findMany({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' }, take: 2 });
  const name = empty!.nameAr;

  // أي نافذة متصفح أصلية هنا عيب: لا تُقبل صامتة كما كانت
  const native: string[] = [];
  page.on('dialog', (d) => {
    native.push(d.message());
    void d.dismiss();
  });

  await page.goto(`/login?next=${encodeURIComponent('/vendor/categories')}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();

  const remove = page.getByRole('button', { name: `احذف «${name}»` });
  const dialog = page.getByRole('dialog', { name: `تحذف فئة «${name}»؟` });

  // التراجع: بالزرّ ثم بـ Esc — والفئة باقية. والتركيز يبدأ على «تراجع» في الإجراء الخطِر
  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'تراجع' })).toBeFocused();
  await dialog.getByRole('button', { name: 'تراجع' }).click();
  await expect(dialog).toBeHidden();
  await remove.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await prisma.vendorCategory.count({ where: { id: empty!.id } })).toBe(1);

  // لغة الصفحة تحكم كلماتها الثابتة — وتعود عربية مع الصفحة
  await page.evaluate(() => document.documentElement.setAttribute('lang', 'en'));
  await remove.click();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.evaluate(() => document.documentElement.setAttribute('lang', 'ar'));

  // التأكيد يحذف
  await remove.click();
  await dialog.getByRole('button', { name: 'احذف الفئة' }).click();
  await expect(page.getByText(`حُذفت «${name}».`)).toBeVisible();
  expect(await prisma.vendorCategory.count({ where: { id: empty!.id } })).toBe(0);
  expect(native).toEqual([]);
});
