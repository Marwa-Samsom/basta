import { paymentProviderContract } from './domain/provider.contract';
import { FakePaymentProvider } from './infrastructure/fake-provider';

/**
 * كل محوّل دفع يُسجَّل هنا ويجتاز العقد قبل وصله. البوابة الحقيقية (Q-09)
 * تُضاف سطراً بمفاتيح وضعها التجريبي — ولا تُوصل إن سقط بند.
 */
paymentProviderContract('المزوّد الوهمي', () => {
  const provider = new FakePaymentProvider();
  return {
    provider,
    tokens: { success: 'tok_success', decline: 'tok_decline' },
    currency: 'SAR',
    signWebhook: (body) => FakePaymentProvider.sign(body),
    webhookBody: (intentId, orderId, amountMinor) => provider.eventFor(intentId, orderId, amountMinor, 'SAR'),
  };
});
