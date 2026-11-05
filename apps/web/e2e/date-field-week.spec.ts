import { expect, test, type Page } from '@playwright/test';

/**
 * عمود «الجمعة» خارج التقويم بالعربية — ACFG-089، 4 نوفمبر 2026. أسماء الأيام كانت كاملة («الأربعاء»،
 * «الخميس») وأعرض من سُبع النافذة، فاتّسعت الأعمدة وخرج السابع يساراً: 31 يناير 2025 لم يُختر،
 * ولا أي جمعة في أي خانة تاريخ. وفترة التقارير الفارغة بلا «جرّب فترة أطول.».
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — المدير بتحقّق ثنائي، واختبارات الدخول تأكل حدّ
 * المحاولات الذي تجرّب به صاحبة المشروع على الخادم نفسه.
 */

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-admin', roles: ['admin'], permissions: ['reports.view'] })}.x`;
};

/** التقارير بمدير مزيّف وفترة بلا طلبات */
async function reportsAs(page: Page) {
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-admin', roles: ['admin'], permissions: ['reports.view'] } }));
  await page.route('**/api/v1/me/notifications*', (r) => r.fulfill({ json: { unread: 0, items: [] } }));
  await page.route('**/api/v1/admin/reports/financial?*', (r) =>
    r.fulfill({ json: { sales: [], ledger: [], activeVendors: 0, conversion: { carts: 0, paidOrders: 0, ratePct: null }, usd: { note: '', rows: [] } } }),
  );
}

for (const width of [1280, 375]) {
  test(`التقويم بالعربية: الأيام السبعة داخل النافذة و31 يناير 2025 (جمعة) يُختار — عرض ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await reportsAs(page);
    await page.goto('/admin/reports');
    await expect(page.getByText('لا بيانات في هذه الفترة')).toBeVisible();

    await page.getByRole('button', { name: /^من:/ }).click();
    const pop = page.getByRole('dialog', { name: 'اختر تاريخاً' });
    await expect(pop).toBeVisible();
    // إلى يناير 2025 بزرّ «الشهر السابق»
    for (let i = 0; i < 24 && !(await pop.getByText('يناير 2025').isVisible()); i++) await pop.getByRole('button', { name: 'الشهر السابق' }).click();
    await expect(pop.getByText('يناير 2025')).toBeVisible();

    const box = (await pop.boundingBox())!;
    const inside = async (selector: string) => {
      const cells = pop.locator(selector);
      const out: string[] = [];
      for (let i = 0; i < (await cells.count()); i++) {
        const b = (await cells.nth(i).boundingBox())!;
        if (b.x < box.x || b.x + b.width > box.x + box.width + 0.5) out.push((await cells.nth(i).getAttribute('data-day')) ?? (await cells.nth(i).innerText()));
      }
      return out;
    };
    expect(await inside('.date-pop__weekday'), 'أسماء أيام خارج النافذة').toEqual([]);
    expect(await inside('.date-pop__day'), 'أيام خارج النافذة').toEqual([]);
    await expect(pop.locator('.date-pop__weekday')).toHaveCount(7);

    await pop.getByRole('button', { name: '31 يناير 2025' }).click();
    await expect(page.getByRole('button', { name: /^من:/ })).toContainText('31 يناير 2025');
  });
}

test('التقارير: الفترة بلا طلبات تقترح «جرّب فترة أطول.»', async ({ page }) => {
  await reportsAs(page);
  await page.goto('/admin/reports');
  await expect(page.getByText('تظهر الأرقام هنا بمجرّد وجود طلبات مدفوعة. جرّب فترة أطول.')).toBeVisible();
});
