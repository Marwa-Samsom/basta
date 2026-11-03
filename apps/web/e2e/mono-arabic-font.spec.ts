import { expect, test } from '@playwright/test';
import { prisma } from './fixtures';

/**
 * الحروف العربية داخل المبلغ بخطّ الواجهة — SYS-080، 2 نوفمبر 2026. رأت صاحبة المشروع في Rendered Fonts
 * لـ «22.240 د.أ»: IBM Plex Mono للأرقام و Courier New للحرفين، فيُرسم الرمز متباعداً «د . أ» (ومثله في
 * مثال العملة وسطر الخانات). خطّ الأرقام بلا عربي، واحتياطه (Consolas) بلا عربي أيضاً.
 */
test('رمز العملة العربي في .money يُرسم بـ IBM Plex Sans Arabic لا بخطّ نظام', async ({ page }) => {
  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'active', deletedAt: null, vendor: { status: 'approved' }, variants: { some: { isActive: true, archivedAt: null } } },
    select: { slug: true },
  });
  await page.goto(`/p/${encodeURIComponent(product.slug)}`);
  const price = page.locator('.sd-price__now');
  await expect(price).toContainText(/[؀-ۿ]/);
  await page.evaluate(() => document.fonts.ready);

  // ما رسمه المتصفح فعلاً لنصّ العنصر — ما تعرضه DevTools في Computed ← Rendered Fonts
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.sd-price__now' });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  const families = fonts.map((f) => f.familyName);

  expect(families.some((f) => /IBM Plex Sans Arabic/.test(f)), families.join(' | ')).toBe(true);
  expect(families.filter((f) => !/^IBM Plex/.test(f)), families.join(' | ')).toEqual([]);
});
