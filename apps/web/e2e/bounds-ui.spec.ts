import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeAdmin, prisma, register, tag } from './fixtures';

/**
 * موجة «يُؤتمت» الرابعة (3 نوفمبر 2026) — ما تعرضه الشاشة من الحالات التي يحرسها الخادم
 * (اختباراتها في apps/api): الأزرار بحسب حالة المتجر، والأزرار المعطّلة قبل أن يصل الطلب،
 * وعرض النسبة، وتحويل المتجر المرفوض إلى صفحة حالته.
 */
const ALL = [
  'vendors.review', 'catalog.manage', 'orders.manage', 'orders.cancel', 'disputes.resolve', 'payouts.approve', 'commissions.edit',
  'coupons.manage', 'content.manage', 'customers.manage', 'settings.edit', 'reports.view', 'audit.view', 'users.manage',
];

async function signInAdmin(page: Page, next: string): Promise<void> {
  const admin = await makeAdmin(tag(), ALL);
  await page.goto(`/login?next=${next}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === next);
}

async function shopAt(status: 'pending' | 'in_review' | 'approved' | 'suspended' | 'rejected', t: string, extra: Record<string, unknown> = {}) {
  const email = `owner.${t}@basta.test`;
  const userId = await register(email, `بائع ${t}`);
  await prisma.userRole.create({ data: { userId, role: 'vendor_owner' } });
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: userId, slug: `st-${t}`, nameAr: `متجر الحالة ${t}`, status, settlementCurrency: 'SAR', country: 'SA',
      ...(status === 'pending' ? {} : { submittedAt: new Date() }),
      ...extra,
    },
  });
  return { id: v.id, name: v.nameAr, email };
}

type Shop = 'pending' | 'in_review' | 'approved' | 'suspended';

/** يفتح ملف متجر بكل حالة ويقيس كل زرّ: ظاهر حيث يُتوقَّع، وغائب في غيره */
async function buttonsByStatus(page: Page, buttons: Record<string, string>, shown: Record<Shop, string[]>): Promise<void> {
  const t = tag();
  const shops: Record<Shop, { id: string; name: string }> = {
    pending: await shopAt('pending', `${t}p`),
    in_review: await shopAt('in_review', `${t}r`),
    approved: await shopAt('approved', `${t}a`, { approvedAt: new Date() }),
    suspended: await shopAt('suspended', `${t}s`, { approvedAt: new Date(), suspendedAt: new Date() }),
  };
  await signInAdmin(page, '/admin');
  for (const status of Object.keys(shops) as Shop[]) {
    await page.goto(`/admin/vendors/${shops[status].id}`);
    await expect(page.getByRole('heading', { name: shops[status].name })).toBeVisible();
    for (const [key, label] of Object.entries(buttons)) {
      const button = page.getByRole('button', { name: label, exact: true });
      if (shown[status].includes(key)) await expect(button, `${status}: ${label}`).toBeVisible();
      else await expect(button, `${status}: ${label}`).toHaveCount(0);
    }
  }
}

test('«اعتمد المتجر» و«اطلب تعديلاً» في ملف المتجر قيد المراجعة وحده (ADM-033)', async ({ page }) => {
  await buttonsByStatus(page, { approve: 'اعتمد المتجر', changes: 'اطلب تعديلاً' }, {
    pending: [], in_review: ['approve', 'changes'], approved: [], suspended: [],
  });
});

test('«علّق المتجر» للمعتمد وحده، و«إعادة التفعيل» للمعلَّق وحده (ADM-043)', async ({ page }) => {
  await buttonsByStatus(page, { suspend: 'علّق المتجر', reinstate: 'إعادة التفعيل' }, {
    pending: [], in_review: [], approved: ['suspend'], suspended: ['reinstate'],
  });
});

test('«تسجيل التحويل» معطّل بحرفين في مرجع التحويل ويُفعَّل بثلاثة (ADM-082)', async ({ page }) => {
  // طلب سحب «موافق عليه» كما يردّه الخادم — الشاشة وحدها هنا، والخادم في finance.integration.spec.ts
  const now = new Date().toISOString();
  await page.route((u) => u.pathname === '/api/v1/admin/finance/payouts', (route) =>
    route.fulfill({
      json: {
        items: [{
          id: '00000000-0000-4000-8000-000000000082', vendor: 'متجر المرجع', currency: 'SAR', amountMinorUnits: '10000', status: 'approved',
          requestedAt: now, approvedAt: now, paidAt: null, transferReference: null, rejectReason: null,
          bank: { bankName: 'بنك الاختبار', holderName: 'متجر المرجع', ibanLast4: '7519' },
        }],
        total: 1,
      },
    }),
  );
  await signInAdmin(page, '/admin/payouts');
  const reference = page.getByLabel('مرجع التحويل', { exact: true });
  const record = page.getByRole('button', { name: 'تسجيل التحويل' });
  await reference.fill('ab');
  await expect(record).toBeDisabled();
  await reference.fill('abc');
  await expect(record).toBeEnabled();
});

test('«وصل — أكّد» معطّل بحرفين في مرجع التحويل والمبلغ مطابق، ويُفعَّل بثلاثة (ADM-091)', async ({ page }) => {
  const number = 'BST-E2E-ADM091';
  await page.route((u) => u.pathname === '/api/v1/admin/payments/transfers', (route) =>
    route.fulfill({
      json: {
        items: [{
          orderNumber: number, placedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), expired: false,
          amountMinorUnits: '25000', currency: 'JOD', storeCount: 1, buyer: { name: 'مشترٍ الاختبار', email: null, phone: null },
        }],
        total: 1,
      },
    }),
  );
  await page.route((u) => u.pathname === '/api/v1/admin/refunds/awaiting-transfer', (route) => route.fulfill({ json: { items: [], total: 0 } }));
  await signInAdmin(page, '/admin/transfers');
  await page.getByLabel(`المبلغ الذي وصل للطلب ${number}`).fill('25');
  const reference = page.getByLabel(`مرجع التحويل للطلب ${number}`);
  const confirm = page.getByRole('button', { name: 'وصل — أكّد' });
  await reference.fill('ab');
  await expect(confirm).toBeDisabled();
  await reference.fill('abc');
  await expect(confirm).toBeEnabled();
});

test('«اعتماد» الضريبة معطّل والنسبة فارغة أو نصّ، ويُفعَّل برقم (ACFG-031)', async ({ page }) => {
  await signInAdmin(page, '/admin/settings');
  const rate = page.getByLabel('النسبة %');
  const apply = page.getByRole('button', { name: 'اعتماد', exact: true });
  await expect(rate).toHaveValue('');
  await expect(apply).toBeDisabled();
  await rate.fill('abc');
  await expect(apply).toBeDisabled();
  await rate.fill('5');
  await expect(apply).toBeEnabled();
});

test('نسبتا الخصم الحدّيتان تُعرضان «0.01%» و«90%» (ACFG-034)', async ({ page }) => {
  const t = tag().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const codes = { low: `E2EMIN${t}`.slice(0, 30), high: `E2EMAX${t}`.slice(0, 30) };
  // غير ساريين: لا يمسّان متجر التجربة اليدوية
  await prisma.coupon.create({ data: { code: codes.low, scope: 'platform', type: 'percent', valueBps: 1, fundedBy: 'platform', isActive: false } });
  await prisma.coupon.create({ data: { code: codes.high, scope: 'platform', type: 'percent', valueBps: 9000, fundedBy: 'platform', isActive: false } });
  try {
    await signInAdmin(page, '/admin/coupons');
    await expect(page.getByRole('row').filter({ hasText: codes.low })).toContainText('0.01%');
    await expect(page.getByRole('row').filter({ hasText: codes.high })).toContainText('90%');
  } finally {
    await prisma.coupon.deleteMany({ where: { code: { in: Object.values(codes) } } });
  }
});

test('مميّز أُوقف: شارته، وتحريك غيره يُرفض برسالة عند القسم ولا يسقطه، و«إزالة» الموقوف تنجح (ACFG-054)', async ({ page }) => {
  // صاحبة المشروع بالشاشة (3 نوفمبر 2026): كانت الصفحة تُسقط الموقوف من أي حفظ، فحرّكت «ساعة» فاختفى بلا سبب
  const t = tag();
  const shop = await shopAt('approved', `${t}f`, { approvedAt: new Date() });
  const make = async (k: string) =>
    (await prisma.product.create({ data: { vendorId: shop.id, slug: `f54ui-${k}-${t}`, nameAr: `مميّز الشاشة ${k} ${t}`, status: 'active', publishedAt: new Date() } })).id;
  const [a, stopped, c] = [await make('a'), await make('b'), await make('c')];
  const KEY = 'home_featured_product_ids';
  const before = await prisma.setting.findUnique({ where: { key: KEY } });
  const saved = async () => (await prisma.setting.findUniqueOrThrow({ where: { key: KEY } })).valueJson;
  try {
    await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, valueJson: [a, stopped, c] }, update: { valueJson: [a, stopped, c] } });
    // «أوقف المنتج بسبب» من الإدارة يجعله مرفوضاً
    await prisma.product.update({ where: { id: stopped }, data: { status: 'rejected' } });
    await signInAdmin(page, '/admin/storefront');
    const section = page.getByRole('region', { name: 'المنتجات المميّزة في الرئيسية' });
    const item = (k: string) => section.getByRole('listitem').filter({ hasText: `مميّز الشاشة ${k} ${t}` });
    await expect(item('b')).toContainText('لم يعد منشوراً — أزله قبل أي تغيير');
    await expect(item('b').getByRole('button', { name: 'أعلى' })).toBeDisabled();

    await item('c').getByRole('button', { name: 'أعلى' }).click();
    await expect(section.getByRole('alert')).toHaveText('كل المميّز منتجات منشورة.');
    expect(await saved()).toEqual([a, stopped, c]);
    await expect(section.getByRole('listitem')).toHaveCount(3);

    await item('b').getByRole('button', { name: 'إزالة' }).click();
    await expect(page.getByText('حُفظ المميّز.')).toBeVisible();
    await expect(section.getByRole('alert')).toHaveCount(0);
    expect(await saved()).toEqual([a, c]);
    await expect(section.getByRole('listitem')).toHaveCount(2);
  } finally {
    if (before) await prisma.setting.update({ where: { key: KEY }, data: { valueJson: before.valueJson as never } });
    else await prisma.setting.deleteMany({ where: { key: KEY } });
  }
});

test('بائع متجره مرفوض يفتح «منتجاتي»: يتحوّل إلى صفحة حالة طلبه (VCAT-051)', async ({ page }) => {
  const shop = await shopAt('rejected', tag(), { rejectionReason: 'الوثائق غير واضحة — أعد رفعها.', rejectedAt: new Date() });
  await page.goto('/login?next=/vendor/products');
  await page.getByLabel('البريد الإلكتروني').fill(shop.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/onboarding/status');
});
