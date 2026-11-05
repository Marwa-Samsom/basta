import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, prisma, register, tag } from './fixtures';

/**
 * تصفية «طلباتي» والبحث برقم الطلب — BUY-006، 4 نوفمبر 2026. رأت صاحبة المشروع بـ buyer.reset أربعةً وأربعين
 * طلباً بالأحدث أولاً بلا تبويب ولا بحث: لتجد طلباً تنزل وتكبس «المزيد» وتقرأ الأرقام واحداً واحداً.
 */
test('«طلباتي»: تبويبات الحالة بعدّاداتها، والبحث بجزء من الرقم، وحالة فراغ تمسح التصفية، و?status= يفتح التبويب', async ({ page }) => {
  const t = tag();
  const email = `buyer.${t}@basta.test`;
  const buyerId = await register(email, `مشترٍ ${t}`);
  const made: string[] = [];
  const make = async (status: 'processing' | 'completed' | 'refunded', n: number): Promise<string> => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `MO-${t}-${n}`.toUpperCase(),
        idempotencyKey: randomUUID(),
        customerUserId: buyerId,
        status,
        currency: 'SAR',
        itemsSubtotalMinorUnits: 10_000n,
        grandTotalMinorUnits: 10_000n,
        shippingAddressSnapshot: { recipientName: 'مستلم', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' },
      },
    });
    made.push(o.id);
    return o.orderNumber;
  };
  const active = await make('processing', 1);
  const done = await make('completed', 2);
  const done2 = await make('completed', 3);
  const refunded = await make('refunded', 4);
  const row = (number: string) => page.locator('.sp-orders li', { hasText: number });

  try {
    await page.goto('/login?next=/account/orders');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForURL((u) => u.pathname === '/account/orders');

    const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
    await expect(tab('الكل')).toContainText('4');
    await expect(tab('قيد التنفيذ')).toContainText('1');
    await expect(tab('مكتمل')).toContainText('2');
    await expect(tab('ملغى')).toContainText('1');

    await tab('مكتمل').click();
    await expect(tab('مكتمل')).toHaveAttribute('aria-selected', 'true');
    await expect(row(done)).toBeVisible();
    await expect(row(done2)).toBeVisible();
    await expect(row(active)).toHaveCount(0);
    await expect(row(refunded)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('completed');

    // البحث داخل «الكل» بجزء من الرقم
    await tab('الكل').click();
    const search = page.getByRole('searchbox', { name: 'ابحث برقم الطلب' });
    await search.fill(refunded.slice(-5).toLowerCase());
    await expect(row(refunded)).toBeVisible();
    await expect(page.locator('.sp-orders li')).toHaveCount(1);

    // لا مطابق: الحالة تقول ذلك وتمسح البحث
    await search.fill('ZZZZ-NOPE');
    await expect(page.getByText('لا طلب يطابق', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'امسح البحث والتصفية' }).click();
    await expect(search).toHaveValue('');
    await expect(page.locator('.sp-orders li')).toHaveCount(4);

    // الرابط بالتبويب يفتحه
    await page.goto('/account/orders?status=canceled');
    await expect(tab('ملغى')).toHaveAttribute('aria-selected', 'true');
    await expect(row(refunded)).toBeVisible();
    await expect(page.locator('.sp-orders li')).toHaveCount(1);
  } finally {
    await prisma.order.deleteMany({ where: { id: { in: made } } });
  }
});
