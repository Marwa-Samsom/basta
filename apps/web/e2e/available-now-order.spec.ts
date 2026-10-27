import { expect, test } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * «متوفّر الآن» يُقرأ المقاس ثم عدده — DISC-053، 27 أكتوبر 2026.
 *
 * كان السطر نصّاً واحداً «أحمر · S (5)»، فالحرف اللاتيني S يسحب القوس والرقم إلى مقطع
 * يسار-يمين ويظهر من اليمين «أحمر · (5) S». الآن الخيار معزول فيقع العدد يساره.
 */
test('أحمر M نافد: «متوفّر الآن: أحمر · S (5)» والعدد يسار المقاس', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  const color = await prisma.attribute.findUniqueOrThrow({ where: { code: 'color' }, include: { values: true } });
  const size = await prisma.attribute.findUniqueOrThrow({ where: { code: 'size' }, include: { values: true } });
  const red = color.values.find((x) => x.valueAr === 'أحمر')!;

  // المتغيّر الافتراضي يُؤرشف؛ والمنتج لونان × مقاسان: أحمر S متاحه 5 وأحمر M نافد
  await prisma.productVariant.update({ where: { id: v.variantId }, data: { archivedAt: new Date(), isActive: false } });
  for (const [label, stock, price] of [['S', 5, 20_000n], ['M', 0, 22_000n]] as const) {
    const s = size.values.find((x) => x.valueAr === label)!;
    // اللون ثم المقاس كما يُدخلهما البائع؛ والمفتاح وحده مرتّب بمعرّف السمة
    const options = [
      { attributeId: color.id, attributeValueId: red.id },
      { attributeId: size.id, attributeValueId: s.id },
    ];
    const key = [...options].sort((a, b) => (a.attributeId < b.attributeId ? -1 : 1));
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id, vendorId: v.vendorId, sku: `E2E-${t}-${label}`.toUpperCase(), priceMinorUnits: price, isActive: true,
        optionsKey: key.map((o) => `${o.attributeId}:${o.attributeValueId}`).join('|'),
        optionValues: { create: options },
      },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: stock, reserved: 0 } });
    if (stock > 0) await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: stock, reason: 'import' } });
  }

  await page.goto(`/p/${v.productSlug}`);
  await page.locator('.sd-size', { hasText: 'M' }).click();
  const line = page.locator('.sd-others');
  await expect(line).toHaveText('متوفّر الآن: أحمر · S (5)');

  // في سطر عربي يُقرأ من اليمين: المقاس S ثم عدده (5) على يساره
  const [sLeft, countRight] = await line.evaluate((p) => {
    const rectOf = (needle: string) => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent!.indexOf(needle);
        if (at >= 0) {
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + needle.length);
          return r.getBoundingClientRect();
        }
      }
      throw new Error(needle);
    };
    // الرقم عقدة نصّ وحده في التصليح ومع القوسين قبله — يُقاس هو
    return [rectOf('S').left, rectOf('5').right];
  });
  expect(countRight).toBeLessThanOrEqual(sLeft);
});
