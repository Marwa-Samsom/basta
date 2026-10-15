/**
 * صلاحيات الإدارة — AD-23. الدور «admin» يفتح اللوحة، والصلاحية تفتح
 * الإجراء. مدير التسويق لا يعتمد متاجر ولا يحوّل مالاً لأنه يملك اللوحة.
 */
export const PERMISSIONS = [
  { code: 'vendors.review', labelAr: 'مراجعة البائعين', hint: 'اعتماد المتاجر ورفضها وتعليقها وقراءة وثائقها' },
  { code: 'catalog.manage', labelAr: 'الكتالوج', hint: 'الفئات والسمات ومراجعة المنتجات قبل النشر' },
  { code: 'orders.manage', labelAr: 'الطلبات', hint: 'البحث في الطلبات والتدخّل في المرتجعات المتعثّرة' },
  { code: 'orders.cancel', labelAr: 'إلغاء الطلبات', hint: 'إلغاء طلب قبل شحنه مع ردّ المبلغ للمشتري' },
  { code: 'disputes.resolve', labelAr: 'حسم النزاعات', hint: 'قرار نهائي في نزاع مصعَّد' },
  {
    code: 'payouts.approve',
    labelAr: 'السحوبات والتحويلات',
    hint: 'سحوبات البائعين، وتأكيد وصول تحويلات المشترين، وتسجيل ردّ المبالغ لهم — يحرّك مالاً',
  },
  { code: 'commissions.edit', labelAr: 'العمولات', hint: 'تغيير النسب — تسري على الطلبات الجديدة وحدها' },
  { code: 'coupons.manage', labelAr: 'الكوبونات', hint: 'إنشاء الكوبونات وإيقافها' },
  { code: 'content.manage', labelAr: 'المحتوى والإشعارات', hint: 'الصفحات والبانرات والمميَّز وقوالب الإشعارات ومراجعات المنتجات' },
  { code: 'customers.manage', labelAr: 'العملاء', hint: 'عرض حسابات المشترين وتعليقها' },
  { code: 'settings.edit', labelAr: 'الإعدادات', hint: 'إعدادات المنصة والضرائب وأسعار الصرف — أثرها مالي' },
  { code: 'reports.view', labelAr: 'التقارير', hint: 'لوحة المؤشرات والتقارير المالية وتصديرها' },
  { code: 'audit.view', labelAr: 'سجل التدقيق', hint: 'قراءة سجل من فعل ماذا ومتى' },
  { code: 'users.manage', labelAr: 'مستخدمو الإدارة', hint: 'منح صلاحيات الإدارة وسحبها' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
export const PERMISSION_CODES: readonly string[] = PERMISSIONS.map((p) => p.code);

/**
 * الإعدادات القابلة للتحرير وحدود كل منها — AD-26. الإعداد المالي يحمل
 * تحذيره: يُعرض قبل الحفظ ويُعاد في نافذة التأكيد.
 */
export const SETTINGS_SPEC: Record<
  string,
  {
    labelAr: string;
    kind: 'int' | 'currency' | 'enum' | 'text';
    min?: number;
    max?: number;
    options?: string[];
    unit?: string;
    financial?: string;
    /** للنصّ: أطول ما يُقبل، ونمط يُفحص به إن وُجد */
    maxLength?: number;
    pattern?: string;
    hint?: string;
  }
> = {
  hold_period_days: { labelAr: 'تعليق رصيد البائع', kind: 'int', min: 0, max: 60, unit: 'يوم', financial: 'يسري على الطلبات التي تُسلَّم بعد الحفظ؛ ما سُلّم قبله يبقى على موعده.' },
  return_window_days: { labelAr: 'مهلة الإرجاع', kind: 'int', min: 0, max: 60, unit: 'يوم', financial: 'أقصر من فترة التعليق يعني تحرير مال قد يُطلب ردّه بعد صرفه.' },
  reservation_ttl_minutes: { labelAr: 'مهلة حجز المخزون', kind: 'int', min: 5, max: 60, unit: 'دقيقة' },
  vendor_accept_timeout_hours: { labelAr: 'مهلة قبول البائع', kind: 'int', min: 6, max: 168, unit: 'ساعة' },
  // العمولة العامة لا تُحرَّر هنا: مكانها الواحد «قواعد العمولة» (AD-10) — القاعدة العامة
  // هناك تغلب هذا الإعداد، فتحريره كان لا يغيّر شيئاً. default_commission_bps احتياط إن غابت القاعدة
  cart_expiry_hours: { labelAr: 'انتهاء السلة', kind: 'int', min: 1, max: 720, unit: 'ساعة' },
  payment_reconcile_minutes: { labelAr: 'مهلة المصالحة', kind: 'int', min: 1, max: 60, unit: 'دقيقة' },
  fx_spread_bps: { labelAr: 'هامش الصرف', kind: 'int', min: 0, max: 1000, unit: 'نقطة أساس', financial: 'يغيّر السعر المعروض للمشتري بين العملات من الآن؛ المستحقات السابقة على لقطتها.' },
  base_currency: { labelAr: 'عملة المحاسبة', kind: 'currency', financial: 'تغيّر عملة التقارير الموحّدة فقط — لا تمسّ أي دفتر.' },
  coupon_default_funded_by: { labelAr: 'مموّل الكوبون الافتراضي', kind: 'enum', options: ['platform', 'vendor'] },
  // الدفع بتحويل يدوي — ما يراه المشتري بعد «أكّد الطلب». اسم المستفيد ووجهة واحدة
  // على الأقل (كليك أو IBAN) شرطٌ لقبول أي طلب
  transfer_window_hours: {
    labelAr: 'مهلة التحويل',
    kind: 'int',
    min: 6,
    max: 168,
    unit: 'ساعة',
    financial: 'القطع محجوزة للمشتري طوال المهلة، وبعدها يُلغى الطلب. تسري على الطلبات الجديدة وحدها.',
  },
  transfer_beneficiary: { labelAr: 'اسم المستفيد', kind: 'text', maxLength: 120, hint: 'كما يظهر للمحوِّل في تطبيق بنكه' },
  transfer_cliq_alias: {
    labelAr: 'الاسم المستعار على كليك',
    kind: 'text',
    maxLength: 40,
    pattern: '^[A-Za-z0-9._-]{2,40}$',
    hint: 'حروف لاتينية وأرقام، كما سجّلته في بنكك',
  },
  transfer_iban: {
    labelAr: 'رقم الحساب الدولي (IBAN)',
    kind: 'text',
    maxLength: 42,
    pattern: '^[A-Z]{2}[0-9]{2}[A-Z0-9 ]{10,36}$',
    hint: 'يبدأ برمز البلد، مثل JO94…',
  },
  transfer_bank: { labelAr: 'البنك', kind: 'text', maxLength: 80 },
};
