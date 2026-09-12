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
