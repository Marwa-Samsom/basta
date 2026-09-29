/**
 * عقد مزوّد الدفع — المرحلة 12: ما يجب أن يثبته **أي** محوّل قبل وصله.
 *
 * المنصة كلها مبنية على خمسة وعود من المزوّد (ADR-011 و ADR-012). محوّل
 * البوابة الحقيقية حين يُكتب (Q-09) يُشغَّل عليه هذا العقد نفسه في وضعها
 * التجريبي — فإن نجح لا يبقى في الوصل إلا مفاتيح الإنتاج. المزوّد الوهمي
 * يجتازه اليوم في providers.contract.spec.ts.
 *
 * ما لا يُختبر هنا: الشبكة، وصفحات 3-D Secure — تلك في اختبار القبول اليدوي
 * بمبلغ رمزي (docs/04-operations/PAYMENT-GO-LIVE.md).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PaymentProvider } from './provider';

export interface ContractHarness {
  readonly provider: PaymentProvider;
  /** رموز وسائل دفع تجريبية لدى المزوّد لكل نتيجة */
  readonly tokens: { readonly success: string; readonly decline: string };
  readonly currency: string;
  /** يوقّع جسم إشعار كما يوقّعه المزوّد — أو null إن تعذّر محلياً */
  readonly signWebhook: ((body: string) => string) | null;
  /** جسم إشعار نجاح صالح لتفويض — بصيغة المزوّد */
  readonly webhookBody: ((intentId: string, orderId: string, amountMinor: bigint) => string) | null;
}

export function paymentProviderContract(name: string, make: () => ContractHarness): void {
  describe(`عقد مزوّد الدفع — ${name}`, () => {
    const req = (h: ContractHarness, token: string, amountMinor = 12_345n, key = randomUUID()) => ({
      idempotencyKey: key,
      orderId: randomUUID(),
      amountMinor,
      currency: h.currency,
      paymentToken: token,
    });

    it('1 · النجاح يعيد تفويضاً محصَّلاً بمعرّف', async () => {
      const h = make();
      const r = await h.provider.charge(req(h, h.tokens.success));
      expect(r.status).toBe('captured');
      expect(r.intentId).toBeTruthy();
    });

    it('2 · المفتاح نفسه مرتين = خصم واحد وتفويض واحد (ADR-011)', async () => {
      const h = make();
      const key = randomUUID();
      const a = await h.provider.charge(req(h, h.tokens.success, 5_000n, key));
      const b = await h.provider.charge(req(h, h.tokens.success, 5_000n, key));
      expect(b.intentId).toBe(a.intentId);
    });

    it('3 · الرفض نهائي برمز سبب — لا استثناء', async () => {
      const h = make();
      const r = await h.provider.charge(req(h, h.tokens.decline));
      expect(r.status).toBe('failed');
      if (r.status === 'failed') expect(r.code).toBeTruthy();
    });

    it('4 · السؤال عن التفويض يعيد الحقيقة — أساس المصالحة', async () => {
      const h = make();
      const r = await h.provider.charge(req(h, h.tokens.success));
      expect((await h.provider.retrieve(r.intentId)).status).toBe('captured');
    });

    it('5 · استرداد جزئي ثم الباقي ينجحان، وما يتجاوز المحصَّل يُرفض', async () => {
      const h = make();
      const r = await h.provider.charge(req(h, h.tokens.success, 10_000n));
      await expect(h.provider.refund(r.intentId, 4_000n)).resolves.toHaveProperty('refundId');
      await expect(h.provider.refund(r.intentId, 6_000n)).resolves.toHaveProperty('refundId');
      await expect(h.provider.refund(r.intentId, 1n)).rejects.toThrow();
    });

    it('5ب · الاسترداد بمفتاح عدم التكرار نفسه يعيد الردّ الأول ولا يردّ مرتين', async () => {
      const h = make();
      const r = await h.provider.charge(req(h, h.tokens.success, 10_000n));
      const key = `refund-${randomUUID()}`;
      const first = await h.provider.refund(r.intentId, 10_000n, key);
      // إعادة بعد انقطاع: المبلغ كله رُدّ، فلو لم يُحترم المفتاح لرُفض الثاني أو رُدّ مرتين
      await expect(h.provider.refund(r.intentId, 10_000n, key)).resolves.toEqual(first);
      await expect(h.provider.refund(r.intentId, 1n)).rejects.toThrow();
    });

    it('6 · إشعار بتوقيع مزوّر يُرفض، والسليم يُحلَّل بمبلغه', async () => {
      const h = make();
      if (!h.signWebhook || !h.webhookBody) return;
      const r = await h.provider.charge(req(h, h.tokens.success, 7_700n));
      const body = h.webhookBody(r.intentId, randomUUID(), 7_700n);
      expect(() => h.provider.parseWebhook(body, 'deadbeef')).toThrow();
      expect(() => h.provider.parseWebhook(body, undefined)).toThrow();
      const tampered = body.replace('7700', '1');
      expect(() => h.provider.parseWebhook(tampered, h.signWebhook!(body))).toThrow();
      const e = h.provider.parseWebhook(body, h.signWebhook(body));
      expect(e.intentId).toBe(r.intentId);
      expect(e.amountMinor).toBe(7_700n);
    });
  });
}
