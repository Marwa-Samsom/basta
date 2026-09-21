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
  { code: 'payouts.approve', labelAr: 'السحوبات', hint: 'الموافقة على السحب وتسجيل التحويل ورفضه — يحرّك مالاً' },
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
  { labelAr: string; kind: 'int' | 'currency' | 'enum'; min?: number; max?: number; options?: string[]; unit?: string; financial?: string }
> = {
  hold_period_days: { labelAr: 'تعليق رصيد البائع', kind: 'int', min: 0, max: 60, unit: 'يوم', financial: 'يسري على الطلبات التي تُسلَّم بعد الحفظ؛ ما سُلّم قبله يبقى على موعده.' },
  return_window_days: { labelAr: 'مهلة الإرجاع', kind: 'int', min: 0, max: 60, unit: 'يوم', financial: 'أقصر من فترة التعليق يعني تحرير مال قد يُطلب ردّه بعد صرفه.' },
  reservation_ttl_minutes: { labelAr: 'مهلة حجز المخزون', kind: 'int', min: 5, max: 60, unit: 'دقيقة' },
  vendor_accept_timeout_hours: { labelAr: 'مهلة قبول البائع', kind: 'int', min: 6, max: 168, unit: 'ساعة' },
  default_commission_bps: { labelAr: 'العمولة العامة الافتراضية', kind: 'int', min: 0, max: 5000, unit: 'نقطة أساس', financial: 'تسري على الطلبات الجديدة فقط — كل طلب سابق على لقطته.' },
  cart_expiry_hours: { labelAr: 'انتهاء السلة', kind: 'int', min: 1, max: 720, unit: 'ساعة' },
  payment_reconcile_minutes: { labelAr: 'مهلة المصالحة', kind: 'int', min: 1, max: 60, unit: 'دقيقة' },
  fx_spread_bps: { labelAr: 'هامش الصرف', kind: 'int', min: 0, max: 1000, unit: 'نقطة أساس', financial: 'يغيّر السعر المعروض للمشتري بين العملات من الآن؛ المستحقات السابقة على لقطتها.' },
  base_currency: { labelAr: 'عملة المحاسبة', kind: 'currency', financial: 'تغيّر عملة التقارير الموحّدة فقط — لا تمسّ أي دفتر.' },
  coupon_default_funded_by: { labelAr: 'مموّل الكوبون الافتراضي', kind: 'enum', options: ['platform', 'vendor'] },
};
