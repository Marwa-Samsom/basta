import { expect, test, type Page } from '@playwright/test';

/**
 * سجلّ التدقيق بفترة — ACFG-085، 4 نوفمبر 2026. الخادم يقبل ‎?from=&to=‎ ويرفض التاريخ الخاطئ بـ 400، والشاشة
 * بلا حقلي تاريخ: لتصل إلى يوم من الشهر الماضي بين مئة وخمسين ألف سطر تكبس «المزيد» مئات المرّات.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — المدير بتحقّق ثنائي، واختبارات الدخول تأكل حدّ
 * المحاولات الذي تجرّب به صاحبة المشروع على الخادم نفسه.
 */

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-admin', roles: ['admin'], permissions: ['audit.view'] })}.x`;
};

/** السجلّ بمدير مزيّف: كل طلب يُحفظ استعلامه، والإجمالي 7 بفترة و150000 بدونها */
async function auditAs(page: Page): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-admin', roles: ['admin'], permissions: ['audit.view'] } }));
  await page.route('**/api/v1/me/notifications*', (r) => r.fulfill({ json: { unread: 0, items: [] } }));
  await page.route('**/api/v1/admin/audit?*', (r) => {
    const q = new URL(r.request().url()).searchParams;
    asked.push(q);
    r.fulfill({ json: { items: [], total: q.has('from') || q.has('to') ? 7 : 150_000 } });
  });
  return asked;
}

test('سجلّ التدقيق: «من» و«إلى» يرسلان ‎?from=&to=‎ ويحدّدان الإجمالي، و«أزل التصفية» يمسحهما', async ({ page }) => {
  const asked = await auditAs(page);
  await page.goto('/admin/audit');
  await expect(page.getByText('150000 سطر — للقراءة فقط')).toBeVisible();

  // «من»: التقويم يفتح على اليوم، و Enter يختاره
  await page.getByRole('button', { name: /^من:/ }).click();
  await expect(page.getByRole('dialog', { name: 'اختر تاريخاً' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => asked.at(-1)?.get('from') ?? '').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByText('7 سطر — للقراءة فقط')).toBeVisible();

  await page.getByRole('button', { name: /^إلى:/ }).click();
  await page.keyboard.press('Enter');
  await expect.poll(() => asked.at(-1)?.get('to') ?? '').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(asked.at(-1)?.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await page.getByRole('button', { name: 'أزل التصفية' }).click();
  await expect.poll(() => (asked.at(-1)?.has('from') || asked.at(-1)?.has('to') ? 'بفترة' : 'بلا فترة')).toBe('بلا فترة');
  await expect(page.getByText('150000 سطر — للقراءة فقط')).toBeVisible();
});
