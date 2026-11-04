import { expect, type Page, test } from '@playwright/test';
import { makeAdmin, makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * صندوق إشعارات الإدارة — بطلب صاحبة المشروع (28 أكتوبر 2026). كان للمدير الجرس وحده، و«كل
 * الإشعارات» تحته يفتح صفحة المشتري (وللبائع كذلك مع أن له صندوقه). القوالب انتقلت إلى
 * /admin/notifications/templates كما في التصميم (AD-20).
 */
async function signIn(page: Page, email: string, next: string, totp?: () => string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  if (totp) {
    await page.getByLabel('رمز التحقق الثنائي').fill(totp());
    await page.getByRole('button', { name: 'دخول' }).click();
  }
  await page.waitForURL((u) => u.pathname === next);
}

// شاشة عريضة: كان للصندوق سقف 960px يترك فراغاً عريضاً بجانبه (28 أكتوبر 2026)
test.use({ viewport: { width: 1600, height: 900 } });

/** الصندوق يملأ عرض المحتوى كإشعارات المشتري */
async function fillsWidth(page: Page): Promise<void> {
  const [box, room] = await page.locator('.vx-notifs').evaluate((el) => {
    const p = el.parentElement as HTMLElement;
    const s = getComputedStyle(p);
    return [el.getBoundingClientRect().width, p.clientWidth - parseFloat(s.paddingInlineStart) - parseFloat(s.paddingInlineEnd)];
  });
  expect(box).toBeGreaterThan(1000);
  expect(Math.abs(box - room)).toBeLessThan(2);
}

test('المدير: «الإشعارات» في القائمة تفتح صندوقه، و«كل الإشعارات» في الجرس إليه، والقوالب في مكانها', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['disputes.resolve', 'content.manage']);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
  const body = `نزاع مصعَّد على BST-${t}-1 (متجر الاختبار): لم يصلني الاسترداد. ينتظر حسمك.`;
  await prisma.notification.create({
    data: { userId: user.id, channel: 'in_app', templateCode: 'admin_dispute_escalated', status: 'sent', sentAt: new Date(), body, payloadJson: { link: '/admin/disputes' } },
  });
  await signIn(page, admin.email, '/admin', admin.totp);

  // القائمة الجانبية → الصندوق
  await page.getByRole('link', { name: 'الإشعارات', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/admin/notifications');
  await expect(page.getByRole('heading', { name: 'الإشعارات', level: 1 })).toBeVisible();
  const item = page.locator('.vx-note', { hasText: body });
  await expect(item).toContainText('نزاع مصعَّد ينتظر الحسم');
  await fillsWidth(page);
  await page.getByRole('button', { name: /^النزاعات/ }).click();
  await expect(item).toBeVisible();

  // الجرس: «كل الإشعارات» إلى صندوق الإدارة لا صفحة المشتري
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await expect(page.getByRole('link', { name: 'كل الإشعارات' })).toHaveAttribute('href', '/admin/notifications');

  // القوالب في مكانها الجديد
  await page.goto('/admin/notifications/templates');
  await expect(page.getByRole('heading', { name: 'قوالب الإشعارات', level: 1 })).toBeVisible();
});

test('البائع: «كل الإشعارات» في الجرس إلى صندوقه لا صفحة المشتري', async ({ page }) => {
  const v = await makeVendor(tag());
  await signIn(page, v.email, '/vendor/notifications');
  await expect(page.getByRole('heading', { name: 'الإشعارات', level: 1 })).toBeVisible();
  await fillsWidth(page);
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await expect(page.getByRole('link', { name: 'كل الإشعارات' })).toHaveAttribute('href', '/vendor/notifications');
});

/** إشعار في صندوق صاحبه كما يتركه الخادم بعد إرساله */
async function notify(email: string, code: string, body: string, link: string): Promise<void> {
  const { id } = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await prisma.notification.create({ data: { userId: id, channel: 'in_app', templateCode: code, status: 'sent', sentAt: new Date(), body, payloadJson: { link } } });
}

// كانت إشعارات نزاع البائع تظهر «إشعار» بلا عنوان، وسحب النزاع لا يصل أحداً (BUY-059، 28 أكتوبر 2026)
test('البائع: إشعارات النزاع بعناوينها — الفتح والتصعيد والحسم والسحب', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const titles: Record<string, string> = {
    vendor_dispute_opened: 'نزاع جديد على طلب',
    vendor_dispute_escalated: 'صُعِّد نزاع للإدارة',
    vendor_dispute_resolved: 'حُسم نزاع',
    vendor_dispute_withdrawn: 'سحب المشتري نزاعه',
  };
  for (const code of Object.keys(titles)) await notify(v.email, code, `${code} على BST-${t}-1`, '/vendor/disputes');
  await signIn(page, v.email, '/vendor/notifications');
  await page.getByRole('button', { name: /^النزاعات/ }).click();
  for (const [code, title] of Object.entries(titles)) {
    await expect(page.locator('.vx-note', { hasText: `${code} على BST-${t}-1` }).locator('.vx-note__title')).toContainText(title);
  }
});

test('المدير: سحب نزاع مصعَّد بعنوانه في صندوقه', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['disputes.resolve']);
  const body = `سحب المشتري النزاع المصعَّد على BST-${t}-1 (متجر الاختبار). لم يعد ينتظر حسمك.`;
  await notify(admin.email, 'admin_dispute_withdrawn', body, '/admin/disputes');
  await signIn(page, admin.email, '/admin/notifications', admin.totp);
  await page.getByRole('button', { name: /^النزاعات/ }).click();
  await expect(page.locator('.vx-note', { hasText: body }).locator('.vx-note__title')).toContainText('سحب المشتري نزاعاً مصعَّداً');
});

/**
 * من لغة حسابه الإنجليزية يصله الإشعار بالإنجليزية (4 نوفمبر 2026)، والمدير يحرّر نصّه من الصفحة
 * نفسها: «English» تعرض النصوص الإنجليزية من اليسار، ومعاينتها بالعيّنة كما تصل («JOD 125.500»)،
 * والحفظ يكتب الإنجليزي وحده ويترك العربي كما هو.
 */
test('المدير: نصّ الإشعار الإنجليزي يُعرض ويُعاين ويُحفظ دون أن يمسّ العربي', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['content.manage']);
  const key = (locale: string) => ({ code_channel_locale: { code: 'order_placed', channel: 'in_app', locale } });
  // قاعدة التطوير مشتركة: الصفّان يعودان كما كانا تماماً
  const before = await Promise.all(['ar', 'en'].map((l) => prisma.notificationTemplate.findUniqueOrThrow({ where: key(l) })));
  try {
    await signIn(page, admin.email, '/admin/notifications/templates', admin.totp);
    const cell = page.getByRole('button', { name: /^تأكيد الطلب للمشتري · داخل الموقع:/ });
    // داخل مجموعته: زرّ لغة الموقع في الرأس اسمه «English» أيضاً، وهو يقلب اللوحة كلها
    const textLang = page.getByRole('group', { name: 'لغة نصّ الإشعار' });
    await textLang.getByRole('button', { name: 'English', exact: true }).click();
    await expect(textLang.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // اللوحة نفسها باقية بالعربية
    await expect(page.getByRole('heading', { name: 'قوالب الإشعارات', level: 1 })).toBeVisible();
    await cell.click();

    const text = page.getByRole('textbox', { name: 'النص' });
    await expect(text).toHaveValue(before[1]!.body);
    await expect(text).toHaveAttribute('dir', 'ltr');
    const preview = page.locator('.ac2-preview');
    await expect(preview).toHaveAttribute('dir', 'ltr');
    await expect(preview).toContainText('Your order BST-260921-A1B2C3 is confirmed');
    // المبلغ كما يصل بالإنجليزية لا «125.500 د.أ»
    await expect(preview.locator('.ac2-token').nth(1)).toHaveText(/^JOD\s125\.500$/);

    await text.fill(`Order {{order_number}} confirmed: {{amount}}. ${t}`);
    await page.getByRole('button', { name: 'احفظ القالب' }).click();
    await expect(page.getByText('حُفظ القالب — يحتاج مراجعة لغوية قبل اعتماده.')).toBeVisible();
    await expect.poll(async () => (await prisma.notificationTemplate.findUniqueOrThrow({ where: key('en') })).body).toBe(`Order {{order_number}} confirmed: {{amount}}. ${t}`);
    expect((await prisma.notificationTemplate.findUniqueOrThrow({ where: key('ar') })).body).toBe(before[0]!.body);

    // العربية بنصّها كما كان، ومن اليمين
    await textLang.getByRole('button', { name: 'العربية', exact: true }).click();
    await cell.click();
    await expect(text).toHaveValue(before[0]!.body);
    await expect(text).toHaveAttribute('dir', 'rtl');
  } finally {
    for (const r of before) {
      await prisma.notificationTemplate.update({
        where: key(r.locale),
        data: { subject: r.subject, body: r.body, isEnabled: r.isEnabled, reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy, updatedAt: r.updatedAt, updatedBy: r.updatedBy },
      });
    }
  }
});
