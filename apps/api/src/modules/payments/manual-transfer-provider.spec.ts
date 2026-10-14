import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { BANK_TRANSFER_TOKEN, ManualTransferProvider } from './infrastructure/manual-transfer-provider';

/**
 * التحويل اليدوي لا يجتاز عقد البوابة (provider.contract) ولا يُفترض به: لا تحصيل
 * فوري ولا ردّ آلي ولا إشعارات. وعوده هو ما يُفحص هنا — وأهمّها أن الردّ لا يدّعي
 * أن مالاً خرج.
 */
describe('مزوّد التحويل اليدوي', () => {
  const saved = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = saved;
  });

  const req = (token = BANK_TRANSFER_TOKEN, orderId = randomUUID()) => ({
    idempotencyKey: orderId,
    orderId,
    amountMinor: 12_500n,
    currency: 'JOD',
    paymentToken: token,
  });

  it('«ادفع» لا يحصّل شيئاً: الطلب ينتظر التحويل بتفويض مشتقّ منه — الإعادة تعيده نفسه', async () => {
    const provider = new ManualTransferProvider();
    const r = req();
    const first = await provider.charge(r);
    expect(first).toEqual({ status: 'awaiting_transfer', intentId: `mt_${r.orderId}` });
    // بعد إعادة تشغيل الخادم (مزوّد جديد بلا ذاكرة) يعيد التفويض نفسه
    expect(await new ManualTransferProvider().charge(r)).toEqual(first);
    expect(await provider.retrieve(first.intentId)).toEqual(first);
  });

  it('يرفض رمز بطاقة — صفحة قديمة لا تُنشئ طلباً بوسيلة غير موجودة', async () => {
    await expect(new ManualTransferProvider().charge(req('tok_success'))).rejects.toThrow(/التحويل البنكي/);
  });

  it('الردّ «يدوي» لا «تمّ»: لا معرّف ردّ مزعوم، والإدارة تسجّل مرجع تحويلها', async () => {
    const provider = new ManualTransferProvider();
    expect(await provider.refund('mt_x', 5_000n)).toEqual({ status: 'manual' });
    await expect(provider.refund('mt_x', 0n)).rejects.toThrow();
  });

  it('لا إشعارات تُقبل — لا طريق يعلّم طلباً مدفوعاً من خارج لوحة الإدارة', () => {
    expect(() => new ManualTransferProvider().parseWebhook()).toThrow(/لوحة الإدارة/);
  });

  it('يُنشأ في الإنتاج — هو ما يُطلق به قبل ربط بوابة', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => new ManualTransferProvider()).not.toThrow();
  });
});
