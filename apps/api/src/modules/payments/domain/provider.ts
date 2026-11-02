/**
 * طبقة الدفع المجرّدة — ADR-012.
 *
 * خمس عمليات لا غير. لا وحدة خارج وحدة الدفع تعرف اسم مزوّد، والمزوّد الوهمي
 * **مخرَج دائم** لا سقالة: عليه تُبنى اختبارات المرحلة وتبقى بعد وصل البوابة
 * الحقيقية، لأنه وحده يستطيع أن يصنع الفشل عند الطلب.
 */

export type ChargeOutcome =
  /** التفويض والتحصيل تمّا — المال محجوز للمنصة */
  | { readonly status: 'captured'; readonly intentId: string }
  /** رُفض: بطاقة مرفوضة أو رصيد ناقص. نهائي — لا يُعاد بالمعرّف نفسه */
  | { readonly status: 'failed'; readonly intentId: string; readonly code: string; readonly message: string }
  /** يحتاج خطوة من المشتري (3-D Secure). يكتمل بإشعار لاحق */
  | { readonly status: 'requires_action'; readonly intentId: string; readonly actionUrl: string }
  /**
   * تحويل يدوي: لا مال بعد. المشتري يحوّل خلال مهلة، والإدارة تؤكّد الوصول بمرجع
   * التحويل — ذلك التأكيد هو «الإشعار». قبله لا تقسيم ولا قيد للبائع، وبعد المهلة
   * يُلغى الطلب وتعود القطع.
   */
  | { readonly status: 'awaiting_transfer'; readonly intentId: string }
  /**
   * **لا نعرف.** انقطع الاتصال بعد الإرسال: قد يكون المال خُصم وقد لا يكون.
   * هذه الحالة هي سبب وجود المصالحة — لا تُعامل فشلاً (فيدفع مرتين) ولا
   * نجاحاً (فيُشحن بلا مال). تُحسم بسؤال المزوّد لاحقاً.
   */
  | { readonly status: 'unknown'; readonly intentId: string };

export type RefundOutcome =
  /** خرج المال عند المزوّد — معرّف الردّ عنده */
  | { readonly status: 'succeeded'; readonly refundId: string }
  /**
   * لا يخرج آلياً: الإدارة تحوّله بنفسها وتسجّل مرجع التحويل، وعندها فقط يصير
   * «مردوداً» ويُبلَّغ المشتري. «رُدّ المبلغ» قبل أن يخرج المال كذبٌ عليه.
   */
  | { readonly status: 'manual' };

export interface ChargeRequest {
  /** مفتاح عدم التكرار عند المزوّد: إعادة الإرسال لا تخصم مرتين — ADR-011 */
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** رمز وسيلة الدفع من نموذج المزوّد — لا رقم بطاقة يمرّ بخادمنا أبداً */
  readonly paymentToken: string;
}

export interface ProviderEvent {
  readonly eventId: string;
  readonly type: 'payment.captured' | 'payment.failed';
  readonly intentId: string;
  readonly orderId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly failureCode?: string;
}

/** وسيلة الدفع كما تُسجَّل على الدفعة وكما تعرضها الواجهة */
export type PaymentMethod = 'card' | 'bank_transfer';

export interface PaymentProvider {
  readonly name: string;
  readonly method: PaymentMethod;
  /**
   * يرفض رمز وسيلة دفع لا يعرفه المزوّد — يُسأل قبل الحجز والطلب. استثناء `charge` معناه
   * «لا نعرف»، فكان الرمز الخاطئ يُنشئ طلباً «نتحقّق من الدفع» يحبس المخزون حتى المهلة (CHK-065)
   */
  assertToken(paymentToken: string): void;
  charge(request: ChargeRequest): Promise<ChargeOutcome>;
  /** سؤال المزوّد عن حقيقة تفويض — للمصالحة بعد «لا نعرف» */
  retrieve(intentId: string): Promise<ChargeOutcome>;
  /**
   * `idempotencyKey` إلزامي: إعادة الطلب بالمفتاح نفسه — بعد انقطاع أو سقوط
   * خادم أو معاملة أُرجعت بعد نجاح البوابة — تعيد الردّ الأول ولا تردّ المال
   * مرتين. كل ردّ قد يُعاد، فلا ردّ بلا مفتاح ثابت له.
   */
  refund(intentId: string, amountMinor: bigint, idempotencyKey: string): Promise<RefundOutcome>;
  void(intentId: string): Promise<void>;
  /** يتحقّق من توقيع الإشعار ويحلّله. التوقيع الخاطئ يُرفض قبل أي أثر */
  parseWebhook(rawBody: string, signature: string | undefined): ProviderEvent;
}
