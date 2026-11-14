import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { prisma } from './fixtures';
import { addProduct, makeShop, retire, type Shop } from './disc-helpers';

/**
 * الرئيسية كما تديرها الإدارة (DISC-006 · 007 · 008) — البطل والمختارات والحملات.
 *
 * البانرات والمختارات والحملات تُخدم من تخزين دقيقة (lib/storefront.ts)، فكل فحص بعد تغيير
 * يعيد تحميل الصفحة حتى يظهر الجديد — كما تقول الحالات «أعد فتح / بعد دقيقة». وكل ما يُنشأ هنا
 * يُحذف أو يُعاد في النهاية: الرئيسية رئيسية صاحبة المشروع.
 */
test.describe.configure({ timeout: 360_000 });

const shops: Shop[] = [];
test.afterAll(async () => {
  await retire(...shops);
});
async function shop(): Promise<Shop> {
  const s = await makeShop();
  shops.push(s);
  return s;
}

/** يعيد تحميل الرئيسية حتى يصدق الشرط — دقيقة التخزين ثم إعادة التوليد */
async function untilHome(page: Page, check: () => Promise<unknown>, timeout = 150_000): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto('/');
        try {
          return Boolean(await check());
        } catch {
          return false;
        }
      },
      { timeout, intervals: [3_000, 5_000, 10_000] },
    )
    .toBe(true);
}

const KEY = 'home_featured_product_ids';

test('DISC-006: البطل بأول بانر نشط ضمن مدّته بترتيبه؛ الرابط الخارجي القديم يُرفض عند العرض إلى «تصفّح المتاجر»، والداخلي «تسوّق الآن»', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const t = randomUUID().slice(0, 8);
  const make = (titleAr: string | null, data: Record<string, unknown>) =>
    prisma.banner.create({ data: { placement: 'home_hero', imageKey: `banners/${randomUUID()}`, titleAr, isActive: true, ...data } });
  const legacy = await make(`رابط قديم ${t}`, { linkUrl: '//evil.example', sort: -1000 });
  const autumn = await make(`تخفيضات الخريف ${t}`, { linkUrl: '/s/x', sort: -999 });
  const expired = await make(`منتهٍ ${t}`, { endsAt: new Date(Date.now() - 86_400_000), sort: -1001 });
  const scheduled = await make(`مجدول ${t}`, { startsAt: new Date(Date.now() + 86_400_000), sort: -1002 });
  const off = await make(`مطفأ ${t}`, { isActive: false, sort: -1003 });
  const hero = page.locator('section.sd-hero');
  try {
    // مع (هـ): صورته وعنوانه، والرابط الخارجي يسقط فيصير الزرّ «تصفّح المتاجر» إلى /shops
    await untilHome(page, async () => (await hero.getByRole('heading', { level: 1 }).textContent()) === legacy.titleAr);
    await expect(hero.locator('.sd-hero__media img')).toHaveAttribute('alt', legacy.titleAr!);
    await expect(hero.getByRole('link', { name: 'تصفّح المتاجر' })).toHaveAttribute('href', '/shops');
    await expect(hero.locator('a[href*="evil.example"]')).toHaveCount(0);
    // (ب) و(ج) و(د) لا تظهر في أي لافتة من البطل
    const titles = new Set<string>();
    const dots = hero.getByRole('group', { name: 'لافتات الرئيسية' }).getByRole('button');
    const n = await dots.count();
    for (let i = 0; i < n; i++) {
      await dots.nth(i).click();
      titles.add((await hero.getByRole('heading', { level: 1 }).textContent()) ?? '');
    }
    expect(titles).toContain(autumn.titleAr);
    for (const hidden of [expired, scheduled, off]) expect(titles).not.toContain(hidden.titleAr);

    // تعطيل (هـ) من اللوحة: يصير (أ) الأول — عنوانه وصورته بعنوانه و«تسوّق الآن» إلى /s/x
    await prisma.banner.update({ where: { id: legacy.id }, data: { isActive: false } });
    await untilHome(page, async () => (await hero.getByRole('heading', { level: 1 }).textContent()) === autumn.titleAr);
    await expect(hero.locator('.sd-hero__media img')).toHaveAttribute('alt', autumn.titleAr!);
    await expect(hero.getByRole('link', { name: 'تسوّق الآن' })).toHaveAttribute('href', '/s/x');

    // بانر بلا عنوان: الصورة alt «عرض»
    await prisma.banner.update({ where: { id: autumn.id }, data: { titleAr: null } });
    await untilHome(page, async () => (await hero.locator('.sd-hero__media img').getAttribute('alt')) === 'عرض');
    await expect(hero.getByRole('link', { name: 'تسوّق الآن' })).toHaveAttribute('href', '/s/x');
  } finally {
    await prisma.banner.deleteMany({ where: { id: { in: [legacy.id, autumn.id, expired.id, scheduled.id, off.id] } } });
  }
});

test('DISC-007: «مختارات» بترتيب الإدارة، والموقوف ومنتج المتجر المعلَّق يسقطان بلا بطاقة مكسورة، وبلا مرئيّ يختفي القسم', async ({ page }) => {
  const saved = await prisma.setting.findUnique({ where: { key: KEY } });
  const a = await shop();
  const b = await shop();
  const p1 = await addProduct(a, { nameAr: `مختار 1 ${a.t}` });
  const p2 = await addProduct(b, { nameAr: `مختار 2 ${b.t}` });
  const p3 = await addProduct(a, { nameAr: `مختار 3 ${a.t}` });
  const featured = page.locator('section[aria-labelledby="sd-featured-title"]');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await prisma.setting.upsert({ where: { key: KEY }, update: { valueJson: [p3.id, p1.id, p2.id] }, create: { key: KEY, valueJson: [p3.id, p1.id, p2.id] } });
    await untilHome(page, async () => (await featured.locator('.pcard__name').allTextContents()).join('|') === [p3.nameAr, p1.nameAr, p2.nameAr].join('|'));
    await expect(featured.getByRole('heading', { name: 'مختارات' })).toBeVisible();

    await prisma.product.update({ where: { id: p1.id }, data: { status: 'rejected', rejectReason: 'موقوف للاختبار' } });
    await prisma.vendor.update({ where: { id: b.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });
    await untilHome(page, async () => (await featured.locator('.pcard__name').allTextContents()).join('|') === p3.nameAr);
    // البطاقة الباقية كاملة: اسم ومتجر وسعر — لا بطاقة فارغة مكان الساقطين
    await expect(featured.locator('article.pcard')).toHaveCount(1);
    await expect(featured.locator('article.pcard .pcard__vendor')).toHaveText(a.nameAr);
    await expect(featured.locator('article.pcard .money')).toBeVisible();
    await expect(page.getByText('حدث خلل غير متوقّع')).toHaveCount(0);

    await prisma.product.update({ where: { id: p3.id }, data: { status: 'rejected', rejectReason: 'موقوف للاختبار' } });
    await untilHome(page, async () => (await featured.count()) === 0);
    await expect(page.getByRole('heading', { name: 'مختارات' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (saved) await prisma.setting.update({ where: { key: KEY }, data: { valueJson: saved.valueJson as never } });
  }
});

test('DISC-008: home_top بعد المتاجر وقبل «مختارات»، و home_middle بعد «شوهد مؤخراً»؛ الرأس «حتى <اليوم الشهر>» بأرقام لاتينية؛ «استعمل الرمز» للصالح وحده؛ والمخفية لا تظهر', async ({ page }) => {
  const saved = await prisma.setting.findUnique({ where: { key: KEY } });
  const s = await shop();
  const t = s.t;
  const [f, top1, top2, mid, hidden] = [
    await addProduct(s, { nameAr: `مختار الحملات ${t}` }),
    await addProduct(s, { nameAr: `حملة أعلى 1 ${t}` }),
    await addProduct(s, { nameAr: `حملة أعلى 2 ${t}` }),
    await addProduct(s, { nameAr: `حملة وسط ${t}` }),
    await addProduct(s, { nameAr: `منتج مخفي ${t}` }),
  ];
  const valid = await prisma.coupon.create({ data: { code: `TOP${t}`.toUpperCase().slice(0, 30), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' } });
  const capped = await prisma.coupon.create({
    data: { code: `CAP${t}`.toUpperCase().slice(0, 30), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', usageLimitTotal: 3, usedCount: 3 },
  });
  const now = Date.now();
  const H = 3_600_000;
  const endsAt = new Date(now + 3 * 86_400_000);
  const campaign = (nameAr: string, placement: string, data: Record<string, unknown>, products: string[]) =>
    prisma.campaign.create({
      data: { nameAr, placement, startsAt: new Date(now - H), endsAt, ...data, items: { create: products.map((productId, sort) => ({ productId, sort })) } },
    });
  const created = [
    await campaign(`حملة أعلى ${t}`, 'home_top', { couponId: valid.id }, [top2.id, top1.id]),
    await campaign(`حملة وسط ${t}`, 'home_middle', { couponId: capped.id }, [mid.id]),
    await campaign(`مجدولة ${t}`, 'home_top', { startsAt: new Date(now + H), endsAt: new Date(now + 2 * H) }, [top1.id]),
    await campaign(`منتهية ${t}`, 'home_top', { startsAt: new Date(now - 3 * H), endsAt: new Date(now - H) }, [top1.id]),
    await campaign(`موقوفة ${t}`, 'home_top', { isActive: false }, [top1.id]),
    await campaign(`كلها مخفية ${t}`, 'home_middle', {}, [hidden.id]),
  ];
  await prisma.product.update({ where: { id: hidden.id }, data: { status: 'draft' } });
  try {
    await prisma.setting.upsert({ where: { key: KEY }, update: { valueJson: [f.id] }, create: { key: KEY, valueJson: [f.id] } });
    // «شوهد مؤخراً» من تخزين الجهاز: زيارة منتج قبل الرئيسية
    await page.goto(`/p/${f.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(f.nameAr);

    const topSection = page.locator('section.sd-campaign', { has: page.getByRole('heading', { name: `حملة أعلى ${t}` }) });
    const midSection = page.locator('section.sd-campaign', { has: page.getByRole('heading', { name: `حملة وسط ${t}` }) });
    await untilHome(page, async () => (await topSection.count()) === 1 && (await midSection.count()) === 1 && (await page.locator('#sd-featured-title').count()) === 1);
    await expect(page.locator('#sx-recent-title')).toBeVisible();

    // مواضع الأقسام بترتيبها في الصفحة
    const order = await page.evaluate((names) => {
      const at = (el: Element | null) => (el ? [...document.querySelectorAll('h2')].indexOf(el as HTMLHeadingElement) : -1);
      const byText = (text: string) => [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === text) ?? null;
      return {
        shops: at(document.getElementById('sd-shops-title')),
        top: at(byText(names.top)),
        featured: at(document.getElementById('sd-featured-title')),
        recent: at(document.getElementById('sx-recent-title')),
        middle: at(byText(names.middle)),
      };
    }, { top: `حملة أعلى ${t}`, middle: `حملة وسط ${t}` });
    expect(order.shops).toBeGreaterThanOrEqual(0);
    expect(order.shops).toBeLessThan(order.top);
    expect(order.top).toBeLessThan(order.featured);
    expect(order.recent).toBeLessThan(order.middle);

    // الرأس: الاسم و«حتى <اليوم الشهر>» بأرقام لاتينية
    const day = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(endsAt);
    const note = topSection.locator('.sd-section__note');
    await expect(note).toHaveText(new RegExp(`^حتى ${day} \\S+$`));
    await expect(note).not.toHaveText(/[٠-٩]/);
    await expect(topSection.locator('.sd-campaign__coupon')).toHaveText(`استعمل الرمز${valid.code}`);
    await expect(midSection.locator('.sd-campaign__coupon')).toHaveCount(0);
    await expect(midSection.getByText('استعمل الرمز')).toHaveCount(0);
    // منتجات الحملة بترتيب الإدارة وبالبطاقة نفسها
    await expect(topSection.locator('article.pcard .pcard__name')).toHaveText([top2.nameAr, top1.nameAr]);
    await expect(topSection.locator('article.pcard .money')).toHaveCount(2);

    for (const name of [`مجدولة ${t}`, `منتهية ${t}`, `موقوفة ${t}`, `كلها مخفية ${t}`]) {
      await expect(page.getByRole('heading', { name }), name).toHaveCount(0);
    }
  } finally {
    await prisma.campaign.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
    await prisma.coupon.updateMany({ where: { id: { in: [valid.id, capped.id] } }, data: { isActive: false } });
    if (saved) await prisma.setting.update({ where: { key: KEY }, data: { valueJson: saved.valueJson as never } });
  }
});
