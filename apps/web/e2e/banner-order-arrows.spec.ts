import { expect, test, type Page } from '@playwright/test';

/**
 * ترتيب اللافتات من اللوحة — ACFG-052، 5 نوفمبر 2026. عمود «الترتيب» كان رقماً بلا أداة لتغييره (زرّ
 * «ظاهرة» وحده). الآن «للأعلى» و«للأسفل» لكل لافتة ظاهرة، ومعطّلان للمخفية.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — المدير بتحقّق ثنائي، واختبارات الدخول تأكل حدّ
 * المحاولات الذي تجرّب به صاحبة المشروع على الخادم نفسه.
 */

const PERMS = ['content.manage'];
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-admin', roles: ['admin'], permissions: PERMS })}.x`;
};

const banner = (id: string, titleAr: string, sort: number, isActive: boolean) => ({
  id, placement: 'home_hero', imageKey: `banners/${id}`, imageUrl: `/uploads/banners/${id}/full.webp`, linkUrl: '/shops', titleAr, sort,
  startsAt: null, endsAt: null, isActive,
});

async function storefrontAs(page: Page) {
  const moves: { id: string; body: unknown }[] = [];
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/admin/**', (r) => r.fulfill({ json: { items: [], total: 0, counts: {} } }));
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-admin', roles: ['admin'], permissions: PERMS } }));
  await page.route('**/api/v1/me/notifications*', (r) => r.fulfill({ json: { unread: 0, items: [] } }));
  await page.route('**/api/v1/admin/storefront/featured', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/admin/banners?*', (r) =>
    r.fulfill({
      json: {
        items: [banner('00000000-0000-4000-8000-000000000001', 'أعلى 1', 0, true), banner('00000000-0000-4000-8000-000000000002', 'أعلى 2', 1, true), banner('00000000-0000-4000-8000-000000000003', 'مخفية', 0, false)],
        total: 3,
        counts: { all: 3, home: 3 },
        placements: { home_hero: 3 },
      },
    }),
  );
  await page.route('**/api/v1/admin/banners/*/move', (r) => {
    moves.push({ id: r.request().url().split('/banners/')[1]!.split('/')[0]!, body: r.request().postDataJSON() });
    return r.fulfill({ json: { id: 'x', sort: 0 } });
  });
  await page.goto('/admin/storefront');
  return moves;
}

test('لوحة اللافتات: «للأعلى»/«للأسفل» لكل ظاهرة ترسل اتجاهها، ومعطّلان للمخفية', async ({ page }) => {
  const moves = await storefrontAs(page);
  await page.getByRole('button', { name: 'انقل أعلى 2 للأعلى' }).click();
  await expect.poll(() => moves).toEqual([{ id: '00000000-0000-4000-8000-000000000002', body: { direction: 'up' } }]);
  await page.getByRole('button', { name: 'انقل أعلى 1 للأسفل' }).click();
  await expect.poll(() => moves.length).toBe(2);
  expect(moves[1]).toEqual({ id: '00000000-0000-4000-8000-000000000001', body: { direction: 'down' } });
  await expect(page.getByRole('button', { name: 'انقل مخفية للأعلى' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'انقل مخفية للأسفل' })).toBeDisabled();
});
