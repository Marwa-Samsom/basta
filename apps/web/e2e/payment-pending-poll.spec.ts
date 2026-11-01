import { expect, test, type Page } from '@playwright/test';

/**
 * «نتحقّق من الدفع» حين يطول الانتظار — CHK-072، 1 نوفمبر 2026. كانت الصفحة تسأل كل 3
 * ثوانٍ عشرين مرة ثم تتوقّف بصمت، و«بانتظار ردّ البوابة…» يدور للأبد، وحين تحسم المصالحة
 * الدفع بعدها لا تتحدّث (رأته صاحبة المشروع: 22 سؤالاً في 2.8 دقيقة). الآن تواصل السؤال
 * أبطأ بعد الدقيقة الأولى وتقول للمشتري ما يحدث، وخطأ شبكة عابر أثناء الانتظار لا يمحوها.
 */

const NUMBER = 'BST-E2E-PENDING';

/** ردّ الخادم على سؤال الصفحة — يبدّله الاختبار، ويعدّ الأسئلة */
async function serve(page: Page) {
  const state = { reply: 'pending' as 'pending' | 'paid' | 'error', calls: 0 };
  await page.route(
    (url) => url.pathname === `/api/v1/checkout/orders/${NUMBER}`,
    (route) => {
      state.calls++;
      if (state.reply === 'error') {
        return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' });
      }
      return route.fulfill({
        json: {
          orderId: 'e2e-pending',
          orderNumber: NUMBER,
          outcome: state.reply,
          total: { minorUnits: '14026', currency: 'SAR' },
          subOrderCount: 1,
        },
      });
    },
  );
  return state;
}

/** يقدّم الساعة ثانيةً ثانية — بينها يُتمّ المتصفح ما خرج من أسئلة فيُجدول التالي */
async function advance(page: Page, seconds: number) {
  for (let s = 0; s < seconds; s++) await page.clock.runFor(1000);
}

test('بعد الدقيقة الأولى تواصل السؤال وتقول ما يحدث، وتتحدّث حين يُحسم الدفع', async ({ page }) => {
  await page.clock.install();
  const state = await serve(page);
  await page.goto(`/orders/${NUMBER}`);

  const heading = page.getByRole('heading', { name: 'نتحقّق من الدفع' });
  const late = page.getByText('يطول التحقّق أكثر من المعتاد');
  await expect(heading).toBeVisible();
  await expect(late).toBeHidden();

  // الدقيقة الأولى: سؤال كل 3 ثوانٍ، ولا إرشاد بعد
  await advance(page, 50);
  await expect(late).toBeHidden();
  await advance(page, 20);
  await expect(heading).toBeVisible();
  await expect(late).toBeVisible();
  await expect(page.getByText('بانتظار ردّ البوابة…')).toBeVisible();

  // بعدها لا تتوقّف: سؤال كل 15 ثانية — القديمة سكتت هنا عند الواحد والعشرين
  const atMinute = state.calls;
  await advance(page, 60);
  expect(state.calls - atMinute).toBeGreaterThanOrEqual(3);
  expect(state.calls - atMinute).toBeLessThanOrEqual(5);

  // خطأ شبكة عابر أثناء الانتظار لا يمحو الصفحة، والسؤال يستمرّ
  state.reply = 'error';
  const atError = state.calls;
  await advance(page, 20);
  expect(state.calls).toBeGreaterThan(atError);
  await expect(heading).toBeVisible();
  await expect(page.locator('.alert')).toHaveCount(0);

  // المصالحة حسمته بعد دقائق: الصفحة تتحدّث وحدها
  state.reply = 'paid';
  await advance(page, 20);
  await expect(page.getByRole('heading', { name: 'تمّ طلبك' })).toBeVisible();
  const settled = state.calls;
  await advance(page, 45);
  expect(state.calls).toBe(settled);
});
