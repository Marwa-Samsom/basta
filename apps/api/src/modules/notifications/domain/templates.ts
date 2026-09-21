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
];

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
