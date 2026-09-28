import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { InvalidInputError } from '../../../common/errors/domain-error';
import type {
  ChargeOutcome,
  ChargeRequest,
  PaymentProvider,
  ProviderEvent,
} from '../domain/provider';

/**
 * المزوّد الوهمي — يحاكي كل ما تفعله بوابة حقيقية، بما فيه ما تفعله خطأً.
 *
 * رمز الدفع يختار السيناريو، فيُصنع كل فشل عند الطلب:
 *   tok_success    تحصيل ناجح فوراً
 *   tok_decline    بطاقة مرفوضة
 *   tok_insufficient رصيد غير كافٍ
 *   tok_3ds        يحتاج تحقّقاً، ويكتمل بإشعار
 *   tok_timeout    **الاتصال ينقطع بعد الخصم**: المزوّد نجح ولم نسمع — بوابة 08 البند 4
 *   tok_timeout_fail الاتصال ينقطع والخصم لم يقع
 *
 * الحالة في الذاكرة: تكفي لإثبات المصالحة داخل عملية واحدة، والبوابة الحقيقية
 * تحفظها عندها لا عندنا.
 */
const DEV_WEBHOOK_SECRET = 'basta-fake-webhook-secret';

/** يُقرأ عند كل توقيع لا عند التحميل، ليرى الاختبار الذي يبدّل البيئة قيمتَه */
function webhookSecret(): string {
  return process.env['PAYMENT_WEBHOOK_SECRET'] || DEV_WEBHOOK_SECRET;
}

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';

  constructor() {
    // خط الدفاع الثاني بعد loadEnv: أي إقلاع في الإنتاج — ولو من سكربت أو عامل
    // لا يمرّ بـ main.ts — يسقط هنا قبل أن يُقبل «tok_success» طلباً مدفوعاً
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('المزوّد الوهمي للدفع ممنوع في الإنتاج — صِل بوابة حقيقية (ADR-012).');
    }
  }

  /** ما «يعرفه» المزوّد عن كل تفويض — مصدر الحقيقة الذي تسأله المصالحة */
  private readonly intents = new Map<string, ChargeOutcome>();
  /** عدم التكرار عند المزوّد: المفتاح نفسه يعيد النتيجة نفسها لا خصماً ثانياً */
  private readonly byKey = new Map<string, ChargeOutcome>();

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    const seen = this.byKey.get(request.idempotencyKey);
    if (seen) return seen.status === 'unknown' ? this.truth(seen.intentId) : seen;

    const intentId = `fake_pi_${randomUUID()}`;
    let truth: ChargeOutcome;
    let reply: ChargeOutcome;

    switch (request.paymentToken) {
      case 'tok_success':
        truth = reply = { status: 'captured', intentId };
        break;
      case 'tok_decline':
        truth = reply = { status: 'failed', intentId, code: 'card_declined', message: 'رفض البنك البطاقة.' };
        break;
      case 'tok_insufficient':
        truth = reply = {
          status: 'failed',
          intentId,
          code: 'insufficient_funds',
          message: 'الرصيد غير كافٍ.',
        };
        break;
      case 'tok_3ds':
        truth = { status: 'captured', intentId };
        reply = { status: 'requires_action', intentId, actionUrl: `/checkout/verify?intent=${intentId}` };
        break;
      case 'tok_timeout':
        // المال خُصم فعلاً عند المزوّد — لكن الردّ لم يصلنا
        truth = { status: 'captured', intentId };
        reply = { status: 'unknown', intentId };
        break;
      case 'tok_timeout_fail':
        truth = { status: 'failed', intentId, code: 'processing_error', message: 'تعذّرت المعالجة.' };
        reply = { status: 'unknown', intentId };
        break;
      default:
        throw new InvalidInputError('وسيلة دفع غير معروفة.', { token: request.paymentToken });
    }

    this.intents.set(intentId, truth);
    this.byKey.set(request.idempotencyKey, reply);
    if (truth.status === 'captured') this.charged.set(intentId, request.amountMinor);
    return reply;
  }

  async retrieve(intentId: string): Promise<ChargeOutcome> {
    return this.truth(intentId);
  }

  private truth(intentId: string): ChargeOutcome {
    return this.intents.get(intentId) ?? { status: 'failed', intentId, code: 'not_found', message: 'تفويض غير معروف.' };
  }

  /** ما رُدّ لكل تفويض — ليتحقّق الاختبار من المبلغ الذي وصل البوابة فعلاً */
  private readonly refunded = new Map<string, bigint[]>();
  /** ما خُصم فعلاً لكل تفويض — البوابة الحقيقية ترفض ردّ أكثر منه */
  private readonly charged = new Map<string, bigint>();

  async refund(intentId: string, amountMinor: bigint): Promise<{ refundId: string }> {
    // الذاكرة تُفقد عند إعادة التشغيل محلياً؛ التفويض الوهمي يُعرف من شكله
    if (!this.intents.has(intentId) && !intentId.startsWith('fake_pi_')) {
      throw new InvalidInputError('تفويض غير معروف للاسترداد.');
    }
    if (amountMinor <= 0n) throw new InvalidInputError('مبلغ الاسترداد موجب.');
    const charged = this.charged.get(intentId);
    const already = (this.refunded.get(intentId) ?? []).reduce((a, b) => a + b, 0n);
    if (charged !== undefined && already + amountMinor > charged) {
      throw new InvalidInputError('الاسترداد يتجاوز المبلغ المحصَّل.');
    }
    this.refunded.set(intentId, [...(this.refunded.get(intentId) ?? []), amountMinor]);
    return { refundId: `fake_re_${randomUUID()}` };
  }

  refundsOf(intentId: string): readonly bigint[] {
    return this.refunded.get(intentId) ?? [];
  }

  async void(intentId: string): Promise<void> {
    this.intents.set(intentId, { status: 'failed', intentId, code: 'voided', message: 'أُلغي التفويض.' });
  }

  // ------------------------------------------------------------ الإشعارات

  /** يوقّع إشعاراً كما توقّعه البوابة — للاختبار ولمحاكاة 3-D Secure */
  static sign(body: string): string {
    return createHmac('sha256', webhookSecret()).update(body).digest('hex');
  }

  parseWebhook(rawBody: string, signature: string | undefined): ProviderEvent {
    const expected = FakePaymentProvider.sign(rawBody);
    const given = signature ?? '';
    // مقارنة بزمن ثابت: المقارنة العادية تكشف التوقيع حرفاً حرفاً بقياس الزمن
    const valid =
      given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!valid) throw new InvalidInputError('توقيع الإشعار غير صالح.');

    const data = JSON.parse(rawBody) as {
      id: string;
      type: ProviderEvent['type'];
      intentId: string;
      orderId: string;
      amountMinor: string;
      currency: string;
      failureCode?: string;
    };
    return {
      eventId: data.id,
      type: data.type,
      intentId: data.intentId,
      orderId: data.orderId,
      amountMinor: BigInt(data.amountMinor),
      currency: data.currency,
      ...(data.failureCode ? { failureCode: data.failureCode } : {}),
    };
  }

  /** ما يرسله المزوّد بعد أن يكتمل التحقّق — تستدعيه الاختبارات وشاشة 3-D Secure */
  eventFor(intentId: string, orderId: string, amountMinor: bigint, currency: string): string {
    const truth = this.truth(intentId);
    return JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: truth.status === 'captured' ? 'payment.captured' : 'payment.failed',
      intentId,
      orderId,
      amountMinor: amountMinor.toString(),
      currency,
      ...(truth.status === 'failed' ? { failureCode: truth.code } : {}),
    });
  }
}
