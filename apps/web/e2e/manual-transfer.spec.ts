import { expect, test, type Page } from '@playwright/test';
import { API, PASSWORD, makeAdmin, makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * الدفع بتحويل يدوي (PAYMENT_PROVIDER=manual) — من الواجهة كما يمرّ به المشتري والمدير:
 * المدير يضبط بيانات الحساب، والمشتري يؤكّد طلبه فيرى كيف يحوّل، والمدير يؤكّد الوصول
 * بمرجعه فيصل الطلب المتجر، ثم يُلغى فيبقى الردّ «نحوّله» حتى يسجّل المدير مرجع تحويله.
 *
 * يعمل حين يعمل الخادم بالتحويل اليدوي وحده (npm run dev:api مع PAYMENT_PROVIDER=manual،
 * أو تشغيل «api-manual» في .claude/launch.json) — ويُتخطّى مع المزوّد الوهمي.
 */

const KEYS = ['transfer_beneficiary', 'transfer_cliq_alias', 'transfer_iban', 'transfer_bank', 'transfer_window_hours'];
let saved: { key: string; valueJson: unknown }[] = [];

test.beforeAll(async () => {
  saved = await prisma.setting.findMany({ where: { key: { in: KEYS } }, select: { key: true, valueJson: true } });
});

test.afterAll(async () => {
  // قاعدة التطوير لا ترث بيانات حساب الاختبار
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const s of saved) await prisma.setting.create({ data: { key: s.key, valueJson: s.valueJson as never } });
});

async function adminLogin(page: Page, email: string, totp: () => string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next));
}

async function setSetting(page: Page, label: string, value: string) {
  const row = page.locator('.ac2-setting').filter({ has: page.getByLabel(label, { exact: true }) });
  await row.getByLabel(label, { exact: true }).fill(value);
  await row.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('حُفظ الإعداد.')).toBeVisible();
}

test('التحويل اليدوي: يؤكّد المشتري فيرى كيف يحوّل، ويؤكّد المدير الوصول، والردّ لا يُعلَن قبل مرجعه', async ({ browser, page }) => {
  const method = (await (await fetch(`${API}/checkout/payment-method`)).json()) as { method: string };
  test.skip(method.method !== 'bank_transfer', 'الخادم يعمل بالمزوّد الوهمي — شغّله بـ PAYMENT_PROVIDER=manual');

  const t = tag();
  const v = await makeVendor(t);
  const admin = await makeAdmin(t, ['payouts.approve', 'settings.edit']);
  page.on('dialog', (d) => void d.accept());

  // 1 · المدير يضبط ما يراه المشتري
  const adminPage = await (await browser.newContext()).newPage();
  adminPage.on('dialog', (d) => void d.accept());
  await adminLogin(adminPage, admin.email, admin.totp, '/admin/settings');
  await expect(adminPage.getByRole('heading', { name: 'الدفع بالتحويل' })).toBeVisible();
  await setSetting(adminPage, 'اسم المستفيد', 'شركة بسطة للتجارة');
  await setSetting(adminPage, 'الاسم المستعار على كليك', 'BASTA');
  await setSetting(adminPage, 'رقم الحساب الدولي (IBAN)', 'JO94CBJO0010000000000131000302');

  // 2 · المشتري يؤكّد طلبه — لا بطاقات، ولا «ادفع»
  await signInBuyer(page, t);
  await page.goto(`/p/${encodeURIComponent(v.productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.goto('/checkout');
  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الهاتف').fill('+966500000000');
  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').selectOption('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.getByText('تحويل عبر كليك أو تحويل بنكي')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ادفع' })).toHaveCount(0);
  await page.getByRole('button', { name: 'أكّد الطلب' }).click();

  await page.waitForURL(/\/orders\//);
  await expect(page.getByRole('heading', { name: 'حجزنا طلبك — بقي التحويل' })).toBeVisible();
  await expect(page.getByText('BASTA', { exact: true })).toBeVisible();
  await expect(page.getByText('JO94CBJO0010000000000131000302', { exact: true })).toBeVisible();
  const number = decodeURIComponent(page.url().split('/orders/')[1]!);
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: number }, include: { payment: true } });
  expect(order.status).toBe('pending_payment');
  expect(order.payment?.status).toBe('awaiting_transfer');
  // المبلغ كما في كشف البنك — بخانات عملة الطلب (الدينار ثلاث، الريال اثنتان)
  const digits = ['JOD', 'KWD', 'BHD', 'OMR'].includes(order.currency) ? 3 : 2;
  const amount = (Number(order.grandTotalMinorUnits) / 10 ** digits).toFixed(digits);

  await page.goto('/account/orders');
  await expect(page.getByRole('link', { name: new RegExp(number) }).getByText('بانتظار تحويلك')).toBeVisible();

  // 3 · المدير يطابق كشف البنك ويؤكّد
  await adminPage.goto('/admin/transfers');
  const row = adminPage.getByRole('row', { name: new RegExp(number) });
  await row.getByLabel(`مرجع التحويل للطلب ${number}`).fill(`CLQ-${t}`);
  await row.getByLabel(`المبلغ الذي وصل للطلب ${number}`).fill('1.00');
  await expect(row.getByText('لا يطابق مبلغ الطلب', { exact: false })).toBeVisible();
  await row.getByLabel(`المبلغ الذي وصل للطلب ${number}`).fill(amount);
  await row.getByLabel(`من حوّل للطلب ${number}`).fill('من حساب: مشترٍ E2E');
  await row.getByRole('button', { name: 'وصل — أكّد' }).click();
  await expect(adminPage.getByText(`أُكّد تحويل ${number}`, { exact: false })).toBeVisible();
  await expect.poll(async () => (await prisma.order.findUniqueOrThrow({ where: { orderNumber: number } })).status).toBe('processing');

  // 4 · المشتري يلغي بعد الدفع — الردّ ينتظر تحويل المدير، لا «رُدّ المبلغ»
  await page.goto(`/account/orders/${encodeURIComponent(number)}`);
  await page.getByRole('button', { name: 'إلغاء هذا المتجر' }).click();
  await expect(page.getByText('نحوّله لحسابك', { exact: false })).toBeVisible();

  await adminPage.goto('/admin/transfers');
  await adminPage.getByRole('tab', { name: /ردود — للتحويل/ }).click();
  const refundRow = adminPage.getByRole('row', { name: new RegExp(`${number}-1`) });
  await expect(refundRow.getByText('من حساب: مشترٍ E2E', { exact: false })).toBeVisible();
  await refundRow.getByLabel(`مرجع تحويل الردّ ${number}-1`).fill(`OUT-${t}`);
  await refundRow.getByRole('button', { name: 'حوّلته — سجّل' }).click();
  await expect(adminPage.getByText('سُجّل الردّ وأُبلغ المشتري بمرجعه.')).toBeVisible();

  await page.reload();
  await expect(page.getByText(`OUT-${t}`)).toBeVisible();
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: number } } });
  expect(sub.status).toBe('refunded');
});
