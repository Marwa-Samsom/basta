/**
 * القوالب الافتراضية — المصدر الأول لنصوص الإشعارات العربية.
 *
 * تُدرَج في القاعدة عند الإقلاع إن غابت، ثم تُحرَّر من AD-20 ولا يُكتب فوق
 * تعديل الإدارة أبداً. المتغيّرات بين {{ }} ومعلنة لكل حدث: قالب يستعمل
 * متغيّراً غير معلن يُرفض عند الحفظ، فلا يصل مشترياً نصٌّ فيه {{…}} خام.
 *
 * أسلوب الكتابة: فصحى بسيطة، جملة الخبر أولاً ثم ما يفعله القارئ، بلا
 * تعجّب ولا «عزيزي العميل». الرسائل النصية قصيرة (حدّ 160 حرفاً تقريباً).
 */

export const CHANNELS = ['email', 'sms', 'whatsapp', 'push', 'in_app'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'البريد',
  sms: 'رسالة نصية',
  whatsapp: 'واتساب',
  push: 'إشعار المتصفّح',
  in_app: 'داخل الموقع',
};

export interface EventDef {
  readonly code: string;
  readonly labelAr: string;
  /** admin: يصل من يحمل صلاحيته من المديرين وحدهم — enqueueAdmins */
  readonly audience: 'customer' | 'vendor' | 'admin';
  readonly variables: readonly string[];
  readonly sample: Readonly<Record<string, string>>;
  /**
   * نصّه وقنواته من الكود وحده — لا تحرير ولا إيقاف ولا قناة جديدة من الإدارة.
   * لقوالب الرموز: من يملك `content.manage` كان يكتب `{{code}}` في العنوان،
   * ويطلب استعادة لحساب غيره، ويقرأ الرمز من السجل، فيستولي على الحساب.
   */
  readonly locked?: true;
  /** تنبيه أمن: يُحرَّر نصّه ولا يُوقف — إيقافه يُخفي عن الضحية أن حسابها يُسرق */
  readonly mandatory?: true;
  /** متغيّرات سرّية: تُمحى من الإشعار المخزَّن بعد الإرسال، فلا يقرأها السجل */
  readonly secret?: readonly string[];
}

export const EVENTS: readonly EventDef[] = [
  {
    code: 'order_placed',
    labelAr: 'تأكيد الطلب للمشتري',
    audience: 'customer',
    variables: ['name', 'order_number', 'amount', 'store_count', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', amount: '125.500 د.أ', store_count: '2', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    code: 'vendor_new_order',
    labelAr: 'طلب جديد للبائع',
    audience: 'vendor',
    variables: ['store_name', 'order_number', 'amount', 'deadline_hours', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', amount: '199.00 ر.س', deadline_hours: '48', link: '/vendor/orders' },
  },
  {
    code: 'order_status_changed',
    labelAr: 'تغيّر حالة الطلب',
    audience: 'customer',
    variables: ['name', 'order_number', 'store_name', 'status', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', store_name: 'متجر الورد', status: 'تم التسليم', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    // كان الشحن «تغيّر حالة» بلا رقم، وصفحة التتبّع تقول إن الرقم في رسالة الشحن (BUY-086)
    code: 'order_shipped',
    labelAr: 'شحن الطلب للمشتري',
    audience: 'customer',
    variables: ['name', 'order_number', 'store_name', 'tracking_label', 'tracking_number', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', store_name: 'متجر الورد', tracking_label: 'رقم التتبّع', tracking_number: 'BX4821930576', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    code: 'order_canceled',
    labelAr: 'إلغاء جزء من الطلب',
    audience: 'customer',
    variables: ['name', 'order_number', 'store_name', 'reason', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', store_name: 'متجر الورد', reason: 'نفدت الكمية لدى البائع', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    code: 'return_rejected',
    labelAr: 'رفض البائع طلب الإرجاع',
    audience: 'customer',
    variables: ['name', 'order_number', 'store_name', 'reason', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', store_name: 'متجر الورد', reason: 'القطعة مستعملة وليست في غلافها', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    // نجاح وصل من البوابة بعد أن أُغلق الطلب فاشلاً — رُدّ كله، ولم يُنشأ طلب
    code: 'late_payment_refunded',
    labelAr: 'دفع متأخر رُدّ',
    audience: 'customer',
    variables: ['order_number', 'amount'],
    sample: { order_number: 'BST-260921-A1B2C3', amount: '125.500 د.أ' },
  },
  {
    code: 'refund_issued',
    labelAr: 'تنفيذ استرداد',
    audience: 'customer',
    variables: ['name', 'order_number', 'amount', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', amount: '42.000 د.أ', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    // الدفع بتحويل يدوي: الطلب محجوز ولم يُدفع بعد — كيف يحوّل وإلى متى
    code: 'order_awaiting_transfer',
    labelAr: 'طلب بانتظار التحويل',
    audience: 'customer',
    variables: ['name', 'order_number', 'amount', 'pay_to', 'deadline', 'link'],
    sample: {
      name: 'سارة',
      order_number: 'BST-260921-A1B2C3',
      amount: '125.500 د.أ',
      pay_to: 'كليك: BASTA\nالمستفيد: شركة بسطة',
      deadline: '16 أكتوبر 2026، 3:00 م',
      link: '/account/orders/BST-260921-A1B2C3',
    },
  },
  {
    code: 'transfer_expired',
    labelAr: 'إلغاء طلب لم يصل تحويله',
    audience: 'customer',
    variables: ['name', 'order_number', 'hours', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', hours: '48', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    // ردّ بتحويل يدوي — يُرسل بعد أن تسجّل الإدارة مرجع التحويل الصادر، لا قبله
    code: 'refund_transferred',
    labelAr: 'ردّ المبلغ بتحويل',
    audience: 'customer',
    variables: ['name', 'order_number', 'amount', 'reference', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', amount: '42.000 د.أ', reference: 'CLQ-88123', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    // ما لم يلغِه البائع بنفسه: انقضاء مهلة القبول أو الإدارة أو المشتري — كان يعرفه
    // من صفحة طلباته وحدها فقد يجهّز طلباً مُلغى (J-03، 18 أكتوبر 2026)
    code: 'vendor_order_canceled',
    labelAr: 'إلغاء طلب للبائع',
    audience: 'vendor',
    variables: ['store_name', 'order_number', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', reason: 'لم يقبله البائع خلال 48 ساعة', link: '/vendor/orders' },
  },
  {
    code: 'return_requested',
    labelAr: 'طلب إرجاع للبائع',
    audience: 'vendor',
    variables: ['store_name', 'order_number', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', reason: 'وصل تالفاً', link: '/vendor/orders' },
  },
  {
    code: 'dispute_message',
    labelAr: 'رسالة في نزاع',
    audience: 'customer',
    variables: ['name', 'order_number', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3-1', link: '/account/disputes' },
  },
  // النزاع بعد الرسالة: كان التاجر لا يعرف بنزاع عليه إلا إن فتح صفحته، ولا الطرفان
  // بقرار الإدارة إلا من الصفحة نفسها (J-06، 19 أكتوبر 2026)
  {
    code: 'vendor_dispute_opened',
    labelAr: 'نزاع جديد على طلب للبائع',
    audience: 'vendor',
    variables: ['store_name', 'order_number', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', reason: 'لم يصلني الطلب', link: '/vendor/disputes' },
  },
  {
    code: 'dispute_escalated',
    labelAr: 'تصعيد نزاع للإدارة — للمشتري',
    audience: 'customer',
    variables: ['name', 'order_number', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3-1', link: '/account/disputes' },
  },
  {
    code: 'vendor_dispute_escalated',
    labelAr: 'تصعيد نزاع للإدارة — للبائع',
    audience: 'vendor',
    variables: ['store_name', 'order_number', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', link: '/vendor/disputes' },
  },
  {
    code: 'dispute_resolved',
    labelAr: 'قرار النزاع — للمشتري',
    audience: 'customer',
    variables: ['name', 'order_number', 'outcome', 'resolution', 'link'],
    sample: {
      name: 'سارة',
      order_number: 'BST-260921-A1B2C3-1',
      outcome: 'حُسم لصالحك، ويُردّ لك ما بقي من مبلغ هذا المتجر',
      resolution: 'لم يقدّم المتجر ما يثبت التسليم.',
      link: '/account/disputes',
    },
  },
  {
    code: 'vendor_dispute_resolved',
    labelAr: 'قرار النزاع — للبائع',
    audience: 'vendor',
    variables: ['store_name', 'order_number', 'outcome', 'resolution', 'link'],
    sample: {
      store_name: 'متجر الورد',
      order_number: 'BST-260921-A1B2C3-1',
      outcome: 'حُسم لصالحكم، ويُحرَّر مال الطلب بموعده',
      resolution: 'أثبت المتجر التسليم بتوقيع المستلم.',
      link: '/vendor/disputes',
    },
  },
  // للإدارة: ما يوقف مال أحد حتى يتحرّك مدير — لمن يحمل صلاحيته وحده (enqueueAdmins).
  // كانت الإدارة تعرف من بطاقات لوحتها وحدها، فنزاع مصعَّد يجمّد مال متجر لا يراه أحد
  // ما لم يفتح اللوحة (19 أكتوبر 2026)
  {
    code: 'admin_dispute_escalated',
    labelAr: 'نزاع مصعَّد ينتظر الحسم',
    audience: 'admin',
    variables: ['store_name', 'order_number', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', reason: 'لم يصلني الطلب', link: '/admin/disputes' },
  },
  {
    code: 'admin_dispute_waiting',
    labelAr: 'نزاع مصعَّد بلا ردّ من الإدارة',
    audience: 'admin',
    variables: ['store_name', 'order_number', 'reason', 'days', 'link'],
    sample: { store_name: 'متجر الورد', order_number: 'BST-260921-A1B2C3-1', reason: 'لم يصلني الاسترداد', days: '2', link: '/admin/disputes' },
  },
  {
    code: 'admin_payout_requested',
    labelAr: 'طلب سحب ينتظر الموافقة',
    audience: 'admin',
    variables: ['store_name', 'amount', 'link'],
    sample: { store_name: 'متجر الورد', amount: '1,250.00 ر.س', link: '/admin/payouts' },
  },
  {
    code: 'admin_vendor_submitted',
    labelAr: 'متجر ينتظر المراجعة',
    audience: 'admin',
    variables: ['store_name', 'kind', 'link'],
    sample: { store_name: 'متجر الورد', kind: 'أرسل طلب انضمامه', link: '/admin/vendors' },
  },
  {
    code: 'admin_bank_account_added',
    labelAr: 'حساب بنكي ينتظر التوثيق',
    audience: 'admin',
    variables: ['store_name', 'bank_name', 'iban_tail', 'link'],
    sample: { store_name: 'متجر الورد', bank_name: 'البنك الأهلي', iban_tail: '7519', link: '/admin/vendors' },
  },
  {
    code: 'admin_transfer_awaiting',
    labelAr: 'تحويل مشترٍ ينتظر التأكيد',
    audience: 'admin',
    variables: ['order_number', 'amount', 'hours', 'link'],
    sample: { order_number: 'BST-260921-A1B2C3', amount: '45.000 د.أ', hours: '48', link: '/admin/transfers' },
  },
  {
    code: 'admin_refund_awaiting_transfer',
    labelAr: 'ردّ ينتظر التحويل اليدوي',
    audience: 'admin',
    variables: ['order_number', 'amount', 'link'],
    sample: { order_number: 'BST-260921-A1B2C3', amount: '23.000 د.أ', link: '/admin/transfers' },
  },
  {
    code: 'admin_dispute_message',
    labelAr: 'رسالة في نزاع مصعَّد',
    audience: 'admin',
    variables: ['order_number', 'sender', 'link'],
    sample: { order_number: 'BST-260921-A1B2C3-1', sender: 'المشتري', link: '/admin/disputes' },
  },
  {
    code: 'admin_return_stalled',
    labelAr: 'مرتجع لم يستلمه المتجر',
    audience: 'admin',
    variables: ['order_number', 'store_name', 'days', 'link'],
    sample: { order_number: 'BST-260921-A1B2C3-1', store_name: 'متجر الورد', days: '3', link: '/admin/returns' },
  },
  {
    code: 'admin_acceptance_due',
    labelAr: 'طلب قارب مهلة القبول',
    audience: 'admin',
    variables: ['order_number', 'store_name', 'hours', 'link'],
    sample: { order_number: 'BST-260921-A1B2C3-1', store_name: 'متجر الورد', hours: '12', link: '/admin/orders?due=acceptance' },
  },
  {
    code: 'admin_audit_drift',
    labelAr: 'انحراف في فحوص المال',
    audience: 'admin',
    variables: ['check', 'rows', 'link'],
    sample: { check: 'حفظ المال (بائع + منصة + مُسترد ≠ مقبوض)', rows: '2', link: '/admin' },
  },
  {
    code: 'payout_paid',
    labelAr: 'تحويل سحب',
    audience: 'vendor',
    variables: ['store_name', 'amount', 'reference', 'link'],
    sample: { store_name: 'متجر الورد', amount: '1,250.00 ر.س', reference: 'TRX-2026-0001', link: '/vendor/finance' },
  },
  {
    code: 'payout_rejected',
    labelAr: 'رفض طلب سحب',
    audience: 'vendor',
    variables: ['store_name', 'amount', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', amount: '1,250.00 ر.س', reason: 'اسم صاحب الحساب لا يطابق السجل التجاري', link: '/vendor/finance' },
  },
  {
    code: 'vendor_approved',
    labelAr: 'اعتماد المتجر',
    audience: 'vendor',
    variables: ['store_name', 'link'],
    sample: { store_name: 'متجر الورد', link: '/vendor' },
  },
  {
    code: 'vendor_rejected',
    labelAr: 'رفض طلب المتجر',
    audience: 'vendor',
    variables: ['store_name', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', reason: 'صورة السجل التجاري غير واضحة', link: '/vendor/onboarding/status' },
  },
  {
    code: 'product_rejected',
    labelAr: 'إيقاف منتج',
    audience: 'vendor',
    variables: ['store_name', 'product_name', 'reason', 'link'],
    sample: { store_name: 'متجر الورد', product_name: 'فستان كتان', reason: 'الصورة الأولى لا تُظهر المنتج', link: '/vendor/products' },
  },
  {
    code: 'low_stock',
    labelAr: 'مخزون قارب النفاد',
    audience: 'vendor',
    variables: ['store_name', 'items', 'link'],
    sample: { store_name: 'متجر الورد', items: 'فستان كتان (DRS-RED-M): بقي 2، وشاح حرير (SCF-01): نفد', link: '/vendor/inventory' },
  },
  /**
   * رموز الهوية — بالبريد وحده عمداً: رمز تأكيد البريد لا يثبت شيئاً إن
   * وصل من قناة أخرى، ورمز الاستعادة داخل الموقع يسلّم من سرق جلسة كلمة
   * مرور جديدة بلا الحالية. لا رابط في الرسالة: الرمز يُكتب في الصفحة المفتوحة.
   */
  {
    code: 'email_verify_code',
    labelAr: 'رمز تأكيد البريد',
    audience: 'customer',
    variables: ['name', 'code', 'minutes'],
    sample: { name: 'سارة', code: '482913', minutes: '10' },
    locked: true,
    secret: ['code'],
  },
  {
    code: 'password_reset_code',
    labelAr: 'رمز استعادة كلمة المرور',
    audience: 'customer',
    variables: ['name', 'code', 'minutes'],
    sample: { name: 'سارة', code: '482913', minutes: '10' },
    locked: true,
    secret: ['code'],
  },
  /**
   * تنبيهات أمن الحساب — تصل صاحبه أياً كان من فعلها: رمز استعادة استُعمل
   * أو تحقق أُعيد ضبطه ولم يفعله هو = حسابه في خطر، وعليه أن يعرف فوراً.
   */
  {
    code: 'recovery_code_used',
    labelAr: 'استُعمل رمز استعادة',
    audience: 'customer',
    variables: ['left'],
    sample: { left: '9' },
    mandatory: true,
  },
  {
    code: 'totp_rotated',
    labelAr: 'تغيّر جهاز التحقق بخطوتين',
    audience: 'customer',
    variables: [],
    sample: {},
    mandatory: true,
  },
  {
    code: 'totp_reset_by_admin',
    labelAr: 'أعاد الدعم ضبط التحقق بخطوتين',
    audience: 'customer',
    variables: ['reason'],
    sample: { reason: 'فقد صاحب الحساب هاتفه ورموز الاستعادة، وتحقّقنا من هويته.' },
    mandatory: true,
  },
  /**
   * الرسائل — ST-28 و VD-15. تنبيه واحد لكل دفعة غير مقروءة لا لكل رسالة:
   * من يكتب خمس رسائل متتالية لا يُغرق بريد الطرف الآخر بخمس.
   */
  {
    code: 'message_to_vendor',
    labelAr: 'رسالة من مشترٍ',
    audience: 'vendor',
    variables: ['store_name', 'customer_name', 'context', 'preview', 'link'],
    sample: { store_name: 'متجر الورد', customer_name: 'سعد', context: 'منتج: عباءة صوف مطرّزة', preview: 'هل يتوفّر مقاس XL خلال الأسبوع؟', link: '/vendor/messages' },
  },
  {
    code: 'message_to_customer',
    labelAr: 'ردّ من متجر',
    audience: 'customer',
    variables: ['store_name', 'context', 'preview', 'link'],
    sample: { store_name: 'متجر الورد', context: 'منتج: عباءة صوف مطرّزة', preview: 'نعم، متوفّر ونشحنه غداً.', link: '/account/messages' },
  },
  /**
   * أمن مال البائع — لا يُطفأ من التفضيلات: حساب بنكي أُضيف ولم يضفه صاحب
   * المتجر يعني أن أحداً يحاول تحويل رصيده إلى جيبه.
   */
  {
    code: 'bank_account_added',
    labelAr: 'أُضيف حساب بنكي',
    audience: 'vendor',
    variables: ['store_name', 'bank', 'iban_tail', 'link'],
    sample: { store_name: 'متجر الورد', bank: 'مصرف الراجحي', iban_tail: '1180', link: '/vendor/settings' },
    mandatory: true,
  },
  {
    code: 'bank_account_verified',
    labelAr: 'وُثّق حساب بنكي',
    audience: 'vendor',
    variables: ['store_name', 'bank', 'iban_tail', 'link'],
    sample: { store_name: 'متجر الورد', bank: 'مصرف الراجحي', iban_tail: '1180', link: '/vendor/settings' },
  },
];

/**
 * فئات تفضيلات البريد — VD-20. الإطفاء يوقف البريد والرسائل النصية وواتساب
 * وإشعار المتصفّح لأحداث الفئة؛ الإشعار داخل الموقع يبقى دائماً، فلا يضيع
 * شيء — يصل فقط أهدأ. ما ليس هنا (الأمن والهوية) لا يُطفأ.
 */
export const PREF_CATEGORIES = [
  { key: 'orders', labelAr: 'طلب جديد', noteAr: 'عند كل طلب فرعي جديد', codes: ['vendor_new_order'] },
  { key: 'products', labelAr: 'إيقاف منتج', noteAr: 'حين توقف الإدارة منتجاً منشوراً، مع السبب', codes: ['product_rejected'] },
  { key: 'stock', labelAr: 'مخزون منخفض', noteAr: 'عند بلوغ حدّ التنبيه', codes: ['low_stock'] },
  {
    key: 'returns',
    labelAr: 'مرتجع أو نزاع',
    noteAr: 'طلب إرجاع جديد، أو نزاع جديد أو رسالة أو تصعيد فيه — قرار النزاع يصل دائماً',
    codes: ['return_requested', 'dispute_message', 'vendor_dispute_opened', 'dispute_escalated', 'vendor_dispute_escalated'],
  },
  { key: 'payouts', labelAr: 'حالة التحويلات', noteAr: 'التحويل والرفض', codes: ['payout_paid', 'payout_rejected'] },
  { key: 'messages', labelAr: 'رسائل المشترين', noteAr: 'أول رسالة غير مقروءة في كل محادثة', codes: ['message_to_vendor'] },
] as const;

export type PrefCategory = (typeof PREF_CATEGORIES)[number]['key'];

/** فئة الحدث إن كان قابلاً للإطفاء — وإلا undefined */
export const prefCategoryOf = (code: string): PrefCategory | undefined =>
  PREF_CATEGORIES.find((c) => (c.codes as readonly string[]).includes(code))?.key;

export interface TemplateSeed {
  readonly code: string;
  readonly channel: Channel;
  readonly subject: string | null;
  readonly body: string;
}

const t = (code: string, channel: Channel, body: string, subject: string | null = null): TemplateSeed => ({ code, channel, subject, body });

export const DEFAULT_TEMPLATES: readonly TemplateSeed[] = [
  // ---------------------------------------------------------------- المشتري
  t('order_placed', 'email',
    'مرحباً {{name}}،\n\nوصلنا طلبك رقم {{order_number}} ودُفع مبلغه {{amount}}. يصلك من {{store_count}} متجر، ولكل متجر شحنته وحالته.\n\nتتابع طلبك من هنا: {{link}}\n\nبسطة',
    'طلبك {{order_number}} مؤكَّد'),
  t('order_placed', 'sms', 'بسطة: طلبك {{order_number}} مؤكَّد بمبلغ {{amount}}. تابعه من حسابك.'),
  t('order_placed', 'in_app', 'طلبك {{order_number}} مؤكَّد — {{amount}}.'),

  t('order_status_changed', 'email',
    'مرحباً {{name}}،\n\nصارت حالة ما طلبته من {{store_name}} في الطلب {{order_number}}: {{status}}.\n\nالتفاصيل والتتبّع: {{link}}\n\nبسطة',
    'طلبك {{order_number}}: {{status}}'),
  t('order_status_changed', 'push', '{{store_name}}: {{status}} — الطلب {{order_number}}'),
  t('order_status_changed', 'in_app', '{{store_name}}: {{status}} في الطلب {{order_number}}.'),

  t('order_shipped', 'email',
    'مرحباً {{name}}،\n\nشحن {{store_name}} ما طلبته في الطلب {{order_number}}.\n\n{{tracking_label}}: {{tracking_number}}\n\nالتفاصيل والتتبّع: {{link}}\n\nبسطة',
    'شُحن طلبك {{order_number}}'),
  t('order_shipped', 'push', '{{store_name}}: تم الشحن — {{tracking_label}} {{tracking_number}}'),
  t('order_shipped', 'in_app', 'شحن {{store_name}} طلبك {{order_number}} — {{tracking_label}}: {{tracking_number}}.'),

  t('order_canceled', 'email',
    'مرحباً {{name}}،\n\nأُلغي ما طلبته من {{store_name}} في الطلب {{order_number}}. السبب: {{reason}}.\n\nيُردّ مبلغه كاملاً إلى وسيلة دفعك، وباقي الطلب يكمل كما هو.\n\n{{link}}\n\nبسطة',
    'إلغاء جزء من طلبك {{order_number}}'),
  t('order_canceled', 'sms', 'بسطة: أُلغي ما طلبته من {{store_name}} في {{order_number}}، ويُردّ مبلغه كاملاً.'),
  t('order_canceled', 'in_app', 'أُلغي طلبك من {{store_name}} ({{order_number}}) ويُردّ مبلغه كاملاً.'),

  t('return_rejected', 'email',
    'مرحباً {{name}}،\n\nرفض {{store_name}} طلب الإرجاع في الطلب {{order_number}}. السبب: «{{reason}}».\n\nإن لم توافق على الرفض، افتح «لديّ مشكلة» من صفحة الطلب ونراجعه معك.\n\n{{link}}\n\nبسطة',
    'رُفض طلب الإرجاع في {{order_number}}'),
  t('return_rejected', 'in_app', 'رفض {{store_name}} طلب الإرجاع في {{order_number}}. السبب: «{{reason}}».'),

  t('refund_issued', 'email',
    'مرحباً {{name}}،\n\nرددنا {{amount}} إلى وسيلة دفعك عن الطلب {{order_number}}. قد يستغرق ظهوره في كشف بطاقتك بضعة أيام عمل حسب البنك.\n\n{{link}}\n\nبسطة',
    'استرداد {{amount}} عن الطلب {{order_number}}'),
  t('refund_issued', 'in_app', 'رددنا {{amount}} إلى وسيلة دفعك عن الطلب {{order_number}}.'),

  t('order_awaiting_transfer', 'email',
    'مرحباً {{name}}،\n\nحجزنا لك طلبك رقم {{order_number}}، وبقي التحويل. حوّل {{amount}} بالضبط إلى:\n\n{{pay_to}}\n\nواكتب رقم الطلب {{order_number}} في ملاحظة التحويل لنعرف أنه لك.\n\nالقطع محجوزة لك حتى {{deadline}}. نؤكّد وصول تحويلك ونرسل الطلب للمتاجر، ونبلغك حينها. إن لم يصل حتى ذلك الموعد يُلغى الطلب تلقائياً.\n\nالتفاصيل وإلغاء الطلب من هنا: {{link}}\n\nبسطة',
    'حوّل {{amount}} لتأكيد طلبك {{order_number}}'),
  t('order_awaiting_transfer', 'in_app', 'طلبك {{order_number}} محجوز حتى {{deadline}} — حوّل {{amount}} واكتب رقم الطلب في ملاحظة التحويل.'),

  t('transfer_expired', 'email',
    'مرحباً {{name}}،\n\nأُلغي طلبك رقم {{order_number}} لأن تحويله لم يصلنا خلال {{hours}} ساعة، وأعدنا القطع للمتجر.\n\nإن كنت حوّلت فعلاً فراسلنا بمرجع التحويل لنردّه لك، أو اطلب من جديد.\n\n{{link}}\n\nبسطة',
    'أُلغي طلبك {{order_number}} — لم يصل التحويل'),
  t('transfer_expired', 'in_app', 'أُلغي طلبك {{order_number}}: لم يصل تحويله خلال {{hours}} ساعة.'),

  t('refund_transferred', 'email',
    'مرحباً {{name}}،\n\nحوّلنا لك {{amount}} عن الطلب {{order_number}}. مرجع التحويل: {{reference}}.\n\nقد يستغرق ظهوره في حسابك يوم عمل حسب البنك.\n\n{{link}}\n\nبسطة',
    'حوّلنا لك {{amount}} عن الطلب {{order_number}}'),
  t('refund_transferred', 'in_app', 'حوّلنا لك {{amount}} عن الطلب {{order_number}} — مرجع التحويل {{reference}}.'),

  t('late_payment_refunded', 'email',
    'وصلنا تأكيد دفعك للطلب {{order_number}} بعد أن كان قد أُغلق دون إتمام، فلم يُنشأ الطلب.\n\nرددنا المبلغ كاملاً، {{amount}}، إلى وسيلة دفعك. قد يستغرق ظهوره في كشف بطاقتك بضعة أيام عمل حسب البنك.\n\nإن كنت ما زلت تريد المنتجات فاطلبها من جديد.\n\nبسطة',
    'رددنا {{amount}} عن الطلب {{order_number}}'),
  t('late_payment_refunded', 'in_app', 'وصل دفعك للطلب {{order_number}} بعد إغلاقه، فرددنا {{amount}} كاملاً إلى وسيلة دفعك.'),

  t('dispute_message', 'email',
    'مرحباً {{name}}،\n\nوصلتك رسالة جديدة في النزاع على الطلب {{order_number}}. اقرأها وردّ من هنا: {{link}}\n\nبسطة',
    'رسالة جديدة في نزاع الطلب {{order_number}}'),
  t('dispute_message', 'in_app', 'رسالة جديدة في نزاع الطلب {{order_number}}.'),

  t('dispute_escalated', 'email',
    'مرحباً {{name}}،\n\nصُعِّد النزاع على الطلب {{order_number}} إلى إدارة بسطة لتحسمه. يصلك قرارها وسببه هنا وبالبريد، وتستطيع حتى ذلك أن تضيف في النزاع ما يوضّح موقفك: {{link}}\n\nبسطة',
    'صُعِّد نزاع الطلب {{order_number}} للإدارة'),
  t('dispute_escalated', 'in_app', 'صُعِّد نزاع الطلب {{order_number}} للإدارة لتحسمه.'),

  t('dispute_resolved', 'email',
    'مرحباً {{name}}،\n\nحسمت إدارة بسطة النزاع على الطلب {{order_number}}: {{outcome}}.\n\nسبب القرار: {{resolution}}\n\nالتفاصيل: {{link}}\n\nبسطة',
    'حُسم نزاع الطلب {{order_number}}'),
  t('dispute_resolved', 'in_app', 'حُسم نزاع الطلب {{order_number}}: {{outcome}}.'),

  // ----------------------------------------------------------------- الهوية
  // الرمز لا يوضع في العنوان: سجلّ الإرسال في لوحة الإدارة يعرض العنوان
  t('email_verify_code', 'email',
    'مرحباً {{name}}،\n\nرمز تأكيد بريدك في بسطة: {{code}}\n\nاكتبه في صفحة التأكيد المفتوحة لديك. صالح {{minutes}} دقائق ولمرة واحدة.\n\nإن لم تطلبه فتجاهل هذه الرسالة؛ حسابك كما هو.\n\nبسطة',
    'رمز تأكيد بريدك في بسطة'),

  t('password_reset_code', 'email',
    'مرحباً {{name}}،\n\nطلب أحدهم إعادة تعيين كلمة مرور حسابك في بسطة. رمز الاستعادة: {{code}}\n\nاكتبه في صفحة إعادة التعيين مع كلمتك الجديدة. صالح {{minutes}} دقائق ولمرة واحدة، وعند استعماله تُنهى كل جلساتك المفتوحة.\n\nإن لم تطلبه فتجاهل الرسالة؛ كلمة مرورك لم تتغيّر.\n\nبسطة',
    'رمز استعادة كلمة المرور'),

  // العدد يُكتب بعد النقطتين لا داخل الجملة: تمييز العدد في العربية يتغيّر بتغيّره
  t('recovery_code_used', 'email',
    'استُعمل للتوّ أحد رموز الاستعادة لدخول حسابك في بسطة بدل رمز تطبيق المصادقة. الرموز الباقية: {{left}}.\n\nإن كنت أنت فلا شيء عليك؛ أنشئ رموزاً جديدة من صفحة الأمان إن قاربت على النفاد.\n\nإن لم تكن أنت فغيّر كلمة مرورك فوراً وأنهِ الجلسات الأخرى من صفحة حسابك.\n\nبسطة',
    'استُعمل رمز استعادة لدخول حسابك'),
  t('recovery_code_used', 'in_app', 'استُعمل رمز استعادة لدخول حسابك. الرموز الباقية: {{left}}.'),

  t('totp_rotated', 'email',
    'رُبط التحقق بخطوتين على حسابك في بسطة بجهاز مصادقة جديد، وأُصدرت رموز استعادة جديدة أبطلت القديمة، وأُنهيت كل جلساتك.\n\nإن كنت أنت فلا شيء عليك.\n\nإن لم تكن أنت فكلمة مرورك ورمزك معروفان لغيرك: استعد كلمة المرور فوراً وراسلنا.\n\nبسطة',
    'تغيّر جهاز التحقق بخطوتين'),
  t('totp_rotated', 'in_app', 'رُبط التحقق بخطوتين بجهاز جديد وأُصدرت رموز استعادة جديدة. إن لم تكن أنت فراسلنا فوراً.'),

  t('totp_reset_by_admin', 'email',
    'أعاد فريق الدعم ضبط التحقق بخطوتين على حسابك في بسطة، وأُنهيت كل جلساتك. السبب: {{reason}}\n\nحسابك الآن يُفتح بكلمة المرور وحدها — فعّل التحقق بخطوتين من جديد من صفحة الأمان.\n\nإن لم تطلب ذلك فراسلنا فوراً.\n\nبسطة',
    'أُعيد ضبط التحقق بخطوتين على حسابك'),
  t('totp_reset_by_admin', 'in_app', 'أعاد الدعم ضبط التحقق بخطوتين على حسابك. فعّله من جديد من صفحة الأمان.'),

  // ----------------------------------------------------------------- البائع
  t('vendor_new_order', 'email',
    'فريق {{store_name}}،\n\nوصلكم طلب جديد رقم {{order_number}} بقيمة {{amount}}. اقبلوه أو ارفضوه خلال {{deadline_hours}} ساعة، وإلا أُلغي آلياً ورُدّ المبلغ للمشتري.\n\n{{link}}\n\nبسطة',
    'طلب جديد {{order_number}}'),
  t('vendor_new_order', 'whatsapp', 'بسطة: طلب جديد {{order_number}} بقيمة {{amount}} لمتجر {{store_name}}. اقبلوه خلال {{deadline_hours}} ساعة من لوحة البائع.'),
  t('vendor_new_order', 'in_app', 'طلب جديد {{order_number}} — {{amount}}. المهلة {{deadline_hours}} ساعة.'),

  t('vendor_order_canceled', 'email',
    'فريق {{store_name}}،\n\nأُلغي الطلب {{order_number}}. السبب: {{reason}}.\n\nرُدّ مبلغه للمشتري وعادت قطعه إلى مخزونكم، فلا تجهّزوه ولا تشحنوه.\n\n{{link}}\n\nبسطة',
    'أُلغي الطلب {{order_number}}'),
  t('vendor_order_canceled', 'in_app', 'أُلغي الطلب {{order_number}}: {{reason}}. لا تجهّزه.'),

  t('return_requested', 'email',
    'فريق {{store_name}}،\n\nطلب المشتري إرجاع قطع من الطلب {{order_number}}. السبب: {{reason}}.\n\nعند استلامكم القطع أكّدوا ذلك من اللوحة، فتعود للمخزون ويُردّ نصيبها للمشتري.\n\n{{link}}\n\nبسطة',
    'طلب إرجاع على {{order_number}}'),
  t('return_requested', 'in_app', 'طلب إرجاع على {{order_number}}: {{reason}}.'),

  t('vendor_dispute_opened', 'email',
    'فريق {{store_name}}،\n\nفتح المشتري نزاعاً على الطلب {{order_number}}. السبب: {{reason}}.\n\nمال هذا الطلب مجمَّد حتى يُحسم النزاع. اقرؤوا رسالته وردّوا عليه من هنا، فإن لم تتّفقا صعّده أحدكما للإدارة: {{link}}\n\nبسطة',
    'نزاع على الطلب {{order_number}}'),
  t('vendor_dispute_opened', 'in_app', 'نزاع على الطلب {{order_number}}: {{reason}}. ماله مجمَّد حتى يُحسم.'),

  t('vendor_dispute_escalated', 'email',
    'فريق {{store_name}}،\n\nصُعِّد النزاع على الطلب {{order_number}} إلى إدارة بسطة لتحسمه. يصلكم قرارها وسببه هنا وبالبريد، وتستطيعون حتى ذلك أن تضيفوا في النزاع ما يوضّح موقفكم: {{link}}\n\nبسطة',
    'صُعِّد نزاع الطلب {{order_number}} للإدارة'),
  t('vendor_dispute_escalated', 'in_app', 'صُعِّد نزاع الطلب {{order_number}} للإدارة لتحسمه.'),

  t('vendor_dispute_resolved', 'email',
    'فريق {{store_name}}،\n\nحسمت إدارة بسطة النزاع على الطلب {{order_number}}: {{outcome}}.\n\nسبب القرار: {{resolution}}\n\nالتفاصيل: {{link}}\n\nبسطة',
    'حُسم نزاع الطلب {{order_number}}'),
  t('vendor_dispute_resolved', 'in_app', 'حُسم نزاع الطلب {{order_number}}: {{outcome}}.'),

  // ----------------------------------------------------------------- الإدارة
  t('admin_dispute_escalated', 'email',
    'صُعِّد نزاع على الطلب {{order_number}} من متجر {{store_name}} إلى الإدارة. سبب المشتري: {{reason}}.\n\nمال الطلب مجمَّد حتى يُحسم. اقرأ الخيط واحسم من هنا: {{link}}\n\nبسطة',
    'نزاع مصعَّد على {{order_number}}'),
  t('admin_dispute_escalated', 'in_app', 'نزاع مصعَّد على {{order_number}} ({{store_name}}): {{reason}}. ينتظر حسمك.'),

  t('admin_dispute_waiting', 'email',
    'النزاع على الطلب {{order_number}} من متجر {{store_name}} مصعَّد إلى الإدارة ولم يردّ عليه أحد منها منذ {{days}} أيام. سبب المشتري: {{reason}}.\n\nالمشتري ينتظر، ومال الطلب مجمَّد حتى يُحسم. ردّ عليه أو احسمه من هنا: {{link}}\n\nبسطة',
    'نزاع {{order_number}} ينتظر ردّكم منذ {{days}} أيام'),
  t('admin_dispute_waiting', 'in_app', 'نزاع {{order_number}} ({{store_name}}) ينتظر ردّ الإدارة منذ {{days}} أيام: {{reason}}.'),

  t('admin_payout_requested', 'email',
    'طلب متجر {{store_name}} سحب {{amount}} إلى حسابه البنكي الموثَّق.\n\nوافق عليه أو ارفضه من هنا: {{link}}\n\nبسطة',
    'طلب سحب {{amount}} من {{store_name}}'),
  t('admin_payout_requested', 'in_app', 'طلب سحب {{amount}} من {{store_name}} ينتظر موافقتك.'),

  t('admin_vendor_submitted', 'email',
    'متجر {{store_name}} {{kind}}. وثائقه وحسابه البنكي جاهزة للمراجعة.\n\nلا يبيع قبل اعتماده. راجعه من هنا: {{link}}\n\nبسطة',
    'متجر {{store_name}} ينتظر المراجعة'),
  t('admin_vendor_submitted', 'in_app', 'متجر {{store_name}} {{kind}} — ينتظر مراجعتك.'),

  t('admin_bank_account_added', 'email',
    'أضاف متجر {{store_name}} حساباً بنكياً جديداً ({{bank_name}}، ينتهي بـ {{iban_tail}}).\n\nلا يُحوَّل إليه شيء قبل أن يوثّقه أحد الفريق. وثّقه من صفحة المتجر: {{link}}\n\nبسطة',
    'حساب بنكي جديد لـ {{store_name}} ينتظر التوثيق'),
  t('admin_bank_account_added', 'in_app', 'حساب بنكي جديد لـ {{store_name}} ({{bank_name}} …{{iban_tail}}) ينتظر توثيقك.'),

  t('admin_transfer_awaiting', 'email',
    'الطلب {{order_number}} بـ {{amount}} مدفوع بتحويل بنكي، وينتظر أن تؤكّد وصول المال إلى حساب المنصة.\n\nلا يصل المتاجر قبل التأكيد، ويُلغى آلياً إن لم يصل خلال {{hours}} ساعة. أكّده من هنا: {{link}}\n\nبسطة',
    'تحويل الطلب {{order_number}} ينتظر التأكيد'),
  t('admin_transfer_awaiting', 'in_app', 'الطلب {{order_number}} ({{amount}}) ينتظر تأكيد وصول التحويل — يُلغى بعد {{hours}} ساعة.'),

  t('admin_refund_awaiting_transfer', 'email',
    'ردّ {{amount}} للمشتري عن الطلب {{order_number}} لا يخرج آلياً لأنه دُفع بتحويل بنكي.\n\nحوّله إلى المشتري وسجّل مرجع التحويل من هنا: {{link}}\n\nبسطة',
    'ردّ {{amount}} ينتظر تحويلك'),
  t('admin_refund_awaiting_transfer', 'in_app', 'ردّ {{amount}} عن الطلب {{order_number}} ينتظر أن تحوّله للمشتري.'),

  t('admin_dispute_message', 'email',
    'كتب {{sender}} رسالة جديدة في النزاع المصعَّد على الطلب {{order_number}}.\n\nاقرأها قبل أن تحسم: {{link}}\n\nبسطة',
    'رسالة جديدة في نزاع {{order_number}}'),
  t('admin_dispute_message', 'in_app', 'رسالة جديدة من {{sender}} في النزاع المصعَّد على {{order_number}}.'),

  t('admin_return_stalled', 'email',
    'مرتجع الطلب {{order_number}} من متجر {{store_name}} لم يُسجَّل استلامه منذ {{days}} أيام.\n\nالمشتري ينتظر استرداده، ومال الطلب لا يُحرَّر للمتجر ما دام الإرجاع قائماً. تابعه مع المتجر أو سجّل الاستلام بدلاً منه: {{link}}\n\nبسطة',
    'مرتجع {{order_number}} عالق منذ {{days}} أيام'),
  t('admin_return_stalled', 'in_app', 'مرتجع {{order_number}} ({{store_name}}) لم يُستلم منذ {{days}} أيام.'),

  t('admin_acceptance_due', 'email',
    'الطلب {{order_number}} لم يقبله متجر {{store_name}} بعد، ويُلغى آلياً ويُردّ مبلغه خلال {{hours}} ساعة.\n\nذكّر المتجر أو تصرّف من هنا: {{link}}\n\nبسطة',
    'الطلب {{order_number}} قارب مهلة القبول'),
  t('admin_acceptance_due', 'in_app', 'الطلب {{order_number}} ({{store_name}}) لم يُقبل — يُلغى آلياً خلال {{hours}} ساعة.'),

  t('admin_audit_drift', 'email',
    'وجد فحص المال الدوري انحرافاً: {{check}} — {{rows}} صف.\n\nهذا خلل في الدفتر أو المخزون لا يُترك. افحصه الآن من لوحة الإدارة: {{link}}\n\nبسطة',
    'انحراف في فحوص المال: {{check}}'),
  t('admin_audit_drift', 'in_app', 'انحراف في فحوص المال: {{check}} — {{rows}} صف. افحصه الآن.'),

  t('payout_paid', 'email',
    'فريق {{store_name}}،\n\nحوّلنا {{amount}} إلى حسابكم البنكي. مرجع التحويل: {{reference}}.\n\nكشف الحساب: {{link}}\n\nبسطة',
    'حُوِّل {{amount}} إلى حسابكم'),
  t('payout_paid', 'in_app', 'حُوِّل {{amount}} — المرجع {{reference}}.'),

  t('payout_rejected', 'email',
    'فريق {{store_name}}،\n\nلم نستطع تنفيذ طلب سحب {{amount}}. السبب: {{reason}}.\n\nعاد المبلغ إلى رصيدكم المتاح فوراً، ويمكنكم طلبه مجدداً بعد التصحيح.\n\n{{link}}\n\nبسطة',
    'طلب السحب لم يُنفَّذ'),
  t('payout_rejected', 'in_app', 'رُفض طلب سحب {{amount}}: {{reason}}. عاد المبلغ إلى رصيدكم المتاح.'),

  // لا مراجعة قبل النشر (15 أكتوبر 2026): كان يَعِد «كل منتج يظهر للمشترين بعد مراجعته»
  // فينتظر البائع موافقة لن تأتي (VON-044). المهاجرة 20261025190000 تستبدله في القاعدة
  t('vendor_approved', 'email',
    'فريق {{store_name}}،\n\nاعتمدنا متجركم في بسطة. أضيفوا منتجاتكم الآن، وتظهر للمشترين فور نشرها.\n\n{{link}}\n\nبسطة',
    'اعتُمد متجركم في بسطة'),
  t('vendor_approved', 'in_app', 'اعتُمد متجركم. أضيفوا منتجاتكم الآن.'),

  t('vendor_rejected', 'email',
    'فريق {{store_name}}،\n\nراجعنا طلب انضمامكم ولم نعتمده بعد. السبب: {{reason}}.\n\nصحّحوا المطلوب وأعيدوا الإرسال من هنا: {{link}}\n\nبسطة',
    'طلب انضمامكم يحتاج تعديلاً'),
  t('vendor_rejected', 'in_app', 'طلب انضمامكم يحتاج تعديلاً: {{reason}}.'),

  // لا مراجعة قبل النشر (15 أكتوبر 2026): الإدارة توقف المنشور المخالف. المهاجرة
  // 20261015120000 تستبدل النصّ القديم في القاعدة إن لم تحرّره الإدارة
  t('product_rejected', 'email',
    'فريق {{store_name}}،\n\nأوقفنا عرض المنتج «{{product_name}}» في المتجر. السبب: {{reason}}.\n\nعدّلوه ثم انشروه من جديد: {{link}}\n\nبسطة',
    'أوقفنا عرض «{{product_name}}»'),
  t('product_rejected', 'in_app', 'أُوقف عرض «{{product_name}}»: {{reason}}.'),

  t('low_stock', 'email',
    'فريق {{store_name}}،\n\nقارب مخزون هذه المنتجات على النفاد: {{items}}.\n\nزيدوا الكمية قبل أن تنفد فيتوقّف بيعها: {{link}}\n\nبسطة',
    'مخزون قارب النفاد في {{store_name}}'),
  t('low_stock', 'in_app', 'مخزون قارب النفاد: {{items}}.'),

  t('message_to_vendor', 'email',
    'فريق {{store_name}}،\n\nكتب لكم {{customer_name}} بخصوص {{context}}:\n\n«{{preview}}»\n\nالردّ خلال يوم عمل يُبقي المشتري معكم: {{link}}\n\nبسطة',
    'رسالة من {{customer_name}} — {{context}}'),
  t('message_to_vendor', 'in_app', 'رسالة من {{customer_name}} بخصوص {{context}}: {{preview}}'),

  t('bank_account_added', 'email',
    'فريق {{store_name}}،\n\nأُضيف إلى متجركم حساب بنكي جديد في {{bank}} ينتهي بـ {{iban_tail}}. لا تُحوَّل إليه أموال قبل أن يوثّقه فريق بسطة.\n\nإن لم تضيفوه أنتم فغيّروا كلمة المرور فوراً، وأنهوا الجلسات الأخرى، وراسلونا: {{link}}\n\nبسطة',
    'أُضيف حساب بنكي إلى متجركم'),
  t('bank_account_added', 'in_app', 'أُضيف حساب بنكي في {{bank}} ينتهي بـ {{iban_tail}} — بانتظار التوثيق.'),

  t('bank_account_verified', 'email',
    'فريق {{store_name}}،\n\nوثّقنا حسابكم في {{bank}} المنتهي بـ {{iban_tail}}. يمكنكم الآن جعله الحساب الافتراضي للتحويلات: {{link}}\n\nبسطة',
    'وُثّق حسابكم البنكي'),
  t('bank_account_verified', 'in_app', 'وُثّق حسابكم في {{bank}} المنتهي بـ {{iban_tail}}.'),

  // --------------------------------------------------------------- المشتري
  t('message_to_customer', 'email',
    'ردّ {{store_name}} على رسالتك بخصوص {{context}}:\n\n«{{preview}}»\n\nتقرأ المحادثة كاملة وتردّ من هنا: {{link}}\n\nبسطة',
    'ردّ من {{store_name}}'),
  t('message_to_customer', 'in_app', 'ردّ {{store_name}} بخصوص {{context}}: {{preview}}'),
];

const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** المتغيّرات المستعملة في نص — للتحقق عند الحفظ */
export function usedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map((m) => m[1]!))];
}

/** المتغيّر ونقطة تليه إن وُجدت — للتصيير وحده */
const VAR_THEN_DOT = /\{\{\s*([a-z_]+)\s*\}\}(\.?)/g;

/** قيمة تنتهي بنقطة ولو لفّتها علامات الاتجاه: «153.48 ر.س.» */
const endsWithDot = (v: string): boolean => /\.[\u200E\u200F\u2066-\u2069]*$/.test(v);

/**
 * يصيّر القالب. متغيّر ناقص يُسقط الإرسال صراحةً — أفضل من نصّ فيه فراغ
 * أو {{…}} خام يصل المشتري.
 *
 * قيمة تنتهي بنقطة («ر.س.») في آخر الجملة تكفيها نقطتها: «{{amount}}.» لا يصير
 * «140.26 ر.س..» — BUY-030، بطلب صاحبة المشروع (27 أكتوبر 2026).
 */
export function render(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(VAR_THEN_DOT, (_, name: string, dot: string) => {
    const v = vars[name];
    if (v === undefined || v === '') throw new Error(`متغيّر ناقص في القالب: ${name}`);
    return dot && endsWithDot(v) ? v : v + dot;
  });
}

export const eventOf = (code: string): EventDef | undefined => EVENTS.find((e) => e.code === code);

/** ما يحلّ محلّ المتغيّر السرّي في كل ما يُخزَّن بعد الإرسال */
export const REDACTED = '••••••';

/** نسخة من المتغيّرات بلا أسرار الحدث — لما يبقى في القاعدة ويقرؤه السجل */
export function redactVars(code: string, vars: Readonly<Record<string, string>>): Record<string, string> {
  const secret = eventOf(code)?.secret ?? [];
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, secret.includes(k) ? REDACTED : v]));
}

/** القالب كما في الكود — مصدر القوالب المقفولة الوحيد، ولو عُبث بصفّها في القاعدة */
export const defaultTemplate = (code: string, channel: Channel): TemplateSeed | undefined =>
  DEFAULT_TEMPLATES.find((t) => t.code === code && t.channel === channel);
