/** الواجهة العامة لوحدة البائعين — ADR-002. تتّسع في المرحلة 06. */
export { VendorsModule } from '../vendors.module';
export {
  VendorDirectory,
  type VendorStatus,
  type VendorSummary,
} from '../application/vendor-directory.service';

/** تغيّر ظهور متجر — يسجّل فيه الكتالوج تحديث فهرسه */
export { VendorEvents } from '../application/vendor-events';

/** دورة حياة البائع: تقرؤها وحدات أخرى لتقرّر هل يبيع هذا المتجر أصلاً. */
export { canSell, STATUS_LABELS, type VendorLifecycle } from '../domain/onboarding';
