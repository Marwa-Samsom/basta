import { InvalidInputError } from '../../../common/errors/domain-error';
import type {
  ChargeOutcome,
  ChargeRequest,
  PaymentProvider,
  ProviderEvent,
  RefundOutcome,
} from '../domain/provider';

/** رمز وسيلة الدفع الذي ترسله الواجهة لهذا المزوّد — لا بطاقة ولا بيانات بنك */
export const BANK_TRANSFER_TOKEN = 'bank_transfer';

/**
 * التحويل اليدوي (بنكي أو كليك) — المزوّد الحقيقي الوحيد قبل ربط بوابة (UX-OPS-AUDIT البند 8).
 *
 * لا شيء يتحرّك آلياً هنا، وهذا هو المقصود:
 *   · «ادفع» يحجز الطلب بانتظار التحويل — لا مال ولا تقسيم ولا قيد للبائع
 *   · الإدارة تقرأ كشف البنك وتؤكّد الوصول بمرجعه (CheckoutService.confirmTransfer)،
 *     وذلك التأكيد يقوم مقام إشعار البوابة
 *   · الردّ لا يخرج من هنا: يبقى «بانتظار التحويل» حتى تحوّله الإدارة وتسجّل مرجعه
 *
 * بلا حالة في الذاكرة: التفويض مشتقّ من الطلب نفسه، فالإعادة بالمفتاح نفسه أو بعد
 * إعادة تشغيل الخادم تعيد التفويض نفسه. والحقيقة (وصل المال أم لا) في القاعدة لا هنا.
 */
export class ManualTransferProvider implements PaymentProvider {
  readonly name = 'manual';
  readonly method = 'bank_transfer' as const;

  assertToken(paymentToken: string): void {
    if (paymentToken !== BANK_TRANSFER_TOKEN) {
      throw new InvalidInputError('وسيلة الدفع المتاحة التحويل البنكي — حدّث الصفحة.', { token: paymentToken });
    }
  }

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    this.assertToken(request.paymentToken);
    if (request.amountMinor <= 0n) throw new InvalidInputError('مبلغ الطلب موجب.');
    return { status: 'awaiting_transfer', intentId: `mt_${request.orderId}` };
  }

  /** لا طرف خارجي يُسأل: الوصول تؤكّده الإدارة، وانتهاء المهلة تحسمه المصالحة من القاعدة */
  async retrieve(intentId: string): Promise<ChargeOutcome> {
    return { status: 'awaiting_transfer', intentId };
  }

  async refund(_intentId: string, amountMinor: bigint): Promise<RefundOutcome> {
    if (amountMinor <= 0n) throw new InvalidInputError('مبلغ الاسترداد موجب.');
    return { status: 'manual' };
  }

  async void(): Promise<void> {
    // لا تفويض عند طرف آخر يُلغى — الطلب نفسه يُختم في القاعدة
  }

  parseWebhook(): ProviderEvent {
    throw new InvalidInputError('التحويل اليدوي بلا إشعارات — يُؤكَّد الوصول من لوحة الإدارة.');
  }
}
