/**
 * الواجهة العامة لوحدة الهوية — المدخل الوحيد الذي تراه الوحدات الأخرى (ADR-002).
 *
 * ملاحظة على الملكية: نوعا `Actor` و `VendorScope` يعيشان في
 * `common/security` لا هنا. السبب أنهما **مفردات مشتركة** تتكلّمها كل
 * وحدة في النظام، بينما تملك وحدة الهوية *كيفية* إثبات الفاعل: كلمة المرور
 * والرمز وتدويره. خلط الاثنين يجعل كل وحدة تعتمد على الهوية بلا حاجة.
 */
export {
  hashPassword,
  verifyPassword,
  assertPasswordStrength,
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
} from '../domain/password';

export { decideRotation } from '../domain/token-family';
export type { StoredToken, RotationOutcome } from '../domain/token-family';

/**
 * سجل التدقيق مخرَج من الهوية لا من `common`: هو جزء من «من فعل ماذا»
 * الذي تملكه الهوية. كل وحدة تكتب فيه تستورده من هنا (ADR-002).
 */
export { AuditService } from '../infrastructure/audit.service';

/** الوحدة نفسها — تستوردها الوحدات التي تكتب في سجل التدقيق. */
export { IdentityModule } from '../identity.module';

/**
 * إصدار رموز الوصول. تحتاجه وحدة البائعين لحظة تسجيل المتجر: الرمز الذي
 * يحمله المستخدم صدر قبل أن يصير بائعاً، فلا يحمل `vendorId` ولا دور البائع،
 * وكل مسار تالٍ في التأهيل يردّه 403. تجديد الرمز هناك ليس ترفاً بل شرط
 * استمرار الرحلة بلا خروج وعودة.
 */
export { AuthService } from '../application/auth.service';
export { TokenService, type TokenPair } from '../application/token.service';
