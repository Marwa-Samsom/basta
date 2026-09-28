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
  readonly audience: 'customer' | 'vendor';
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
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', store_name: 'متجر الورد', status: 'تم الشحن', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    code: 'order_canceled',
    labelAr: 'إلغاء جزء من الطلب',
    audience: 'customer',
    variables: ['name', 'order_number', 'store_name', 'reason', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', store_name: 'متجر الورد', reason: 'نفدت الكمية لدى البائع', link: '/account/orders/BST-260921-A1B2C3' },
  },
  {
    code: 'refund_issued',
    labelAr: 'تنفيذ استرداد',
    audience: 'customer',
    variables: ['name', 'order_number', 'amount', 'link'],
    sample: { name: 'سارة', order_number: 'BST-260921-A1B2C3', amount: '42.000 د.أ', link: '/account/orders/BST-260921-A1B2C3' },
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
    labelAr: 'رفض منتج',
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
  { key: 'products', labelAr: 'قرار مراجعة منتج', noteAr: 'رفض منتج مع السبب', codes: ['product_rejected'] },
  { key: 'stock', labelAr: 'مخزون منخفض', noteAr: 'عند بلوغ حدّ التنبيه', codes: ['low_stock'] },
  { key: 'returns', labelAr: 'مرتجع أو نزاع', noteAr: 'طلب إرجاع جديد أو رسالة في نزاع', codes: ['return_requested', 'dispute_message'] },
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

  t('order_canceled', 'email',
    'مرحباً {{name}}،\n\nأُلغي ما طلبته من {{store_name}} في الطلب {{order_number}}. السبب: {{reason}}.\n\nيُردّ مبلغه كاملاً إلى وسيلة دفعك، وباقي الطلب يكمل كما هو.\n\n{{link}}\n\nبسطة',
    'إلغاء جزء من طلبك {{order_number}}'),
  t('order_canceled', 'sms', 'بسطة: أُلغي ما طلبته من {{store_name}} في {{order_number}}، ويُردّ مبلغه كاملاً.'),
  t('order_canceled', 'in_app', 'أُلغي طلبك من {{store_name}} ({{order_number}}) ويُردّ مبلغه كاملاً.'),

  t('refund_issued', 'email',
    'مرحباً {{name}}،\n\nرددنا {{amount}} إلى وسيلة دفعك عن الطلب {{order_number}}. قد يستغرق ظهوره في كشف بطاقتك بضعة أيام عمل حسب البنك.\n\n{{link}}\n\nبسطة',
    'استرداد {{amount}} عن الطلب {{order_number}}'),
  t('refund_issued', 'in_app', 'رددنا {{amount}} إلى وسيلة دفعك عن الطلب {{order_number}}.'),

  t('dispute_message', 'email',
    'مرحباً {{name}}،\n\nوصلتك رسالة جديدة في النزاع على الطلب {{order_number}}. اقرأها وردّ من هنا: {{link}}\n\nبسطة',
    'رسالة جديدة في نزاع الطلب {{order_number}}'),
  t('dispute_message', 'in_app', 'رسالة جديدة في نزاع الطلب {{order_number}}.'),

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

  t('return_requested', 'email',
    'فريق {{store_name}}،\n\nطلب المشتري إرجاع قطع من الطلب {{order_number}}. السبب: {{reason}}.\n\nعند استلامكم القطع أكّدوا ذلك من اللوحة، فتعود للمخزون ويُردّ نصيبها للمشتري.\n\n{{link}}\n\nبسطة',
    'طلب إرجاع على {{order_number}}'),
  t('return_requested', 'in_app', 'طلب إرجاع على {{order_number}}: {{reason}}.'),

  t('payout_paid', 'email',
    'فريق {{store_name}}،\n\nحوّلنا {{amount}} إلى حسابكم البنكي. مرجع التحويل: {{reference}}.\n\nكشف الحساب: {{link}}\n\nبسطة',
    'حُوِّل {{amount}} إلى حسابكم'),
  t('payout_paid', 'in_app', 'حُوِّل {{amount}} — المرجع {{reference}}.'),

  t('payout_rejected', 'email',
    'فريق {{store_name}}،\n\nلم نستطع تنفيذ طلب سحب {{amount}}. السبب: {{reason}}.\n\nعاد المبلغ إلى رصيدكم المتاح فوراً، ويمكنكم طلبه مجدداً بعد التصحيح.\n\n{{link}}\n\nبسطة',
    'طلب السحب لم يُنفَّذ'),
  t('payout_rejected', 'in_app', 'رُفض طلب سحب {{amount}}: {{reason}}. عاد المبلغ إلى رصيدكم المتاح.'),

  t('vendor_approved', 'email',
    'فريق {{store_name}}،\n\nاعتمدنا متجركم في بسطة. أضيفوا منتجاتكم الآن، وكل منتج يظهر للمشترين بعد مراجعته.\n\n{{link}}\n\nبسطة',
    'اعتُمد متجركم في بسطة'),
  t('vendor_approved', 'in_app', 'اعتُمد متجركم. أضيفوا منتجاتكم الآن.'),

  t('vendor_rejected', 'email',
    'فريق {{store_name}}،\n\nراجعنا طلب انضمامكم ولم نعتمده بعد. السبب: {{reason}}.\n\nصحّحوا المطلوب وأعيدوا الإرسال من هنا: {{link}}\n\nبسطة',
    'طلب انضمامكم يحتاج تعديلاً'),
  t('vendor_rejected', 'in_app', 'طلب انضمامكم يحتاج تعديلاً: {{reason}}.'),

  t('product_rejected', 'email',
    'فريق {{store_name}}،\n\nلم ننشر المنتج «{{product_name}}». السبب: {{reason}}.\n\nعدّلوه وأعيدوا إرساله للمراجعة: {{link}}\n\nبسطة',
    'المنتج «{{product_name}}» يحتاج تعديلاً'),
  t('product_rejected', 'in_app', 'لم يُنشر «{{product_name}}»: {{reason}}.'),

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

/**
 * يصيّر القالب. متغيّر ناقص يُسقط الإرسال صراحةً — أفضل من نصّ فيه فراغ
 * أو {{…}} خام يصل المشتري.
 */
export function render(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(VAR, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === '') throw new Error(`متغيّر ناقص في القالب: ${name}`);
    return v;
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
