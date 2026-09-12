/**
 * تجزئة كلمات المرور — argon2id.
 *
 * المعاملات مأخوذة من توصية OWASP لعام 2024: 19 ميغابايت ذاكرة وتكرارَين
 * وتوازٍ واحد. الذاكرة هي ما يجعل الكسر بكروت الرسوميات مكلفاً، لا عدد
 * التكرارات — ولهذا argon2id لا bcrypt.
 *
 * ADR-010: لا يوجد في النظام أي مكان يُخزَّن فيه نصّ كلمة المرور، ولا دالة
 * تُرجعها. المقارنة تتم بالتجزئة وحدها.
 */
import { hash, verify, Algorithm } from '@node-rs/argon2';

const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB — توصية OWASP 2024
  timeCost: 2,
  parallelism: 1,
} as const;

/** الحد الأدنى 8 محارف — SRS C-01. الطول أهم من التعقيد. */
export const MIN_PASSWORD_LENGTH = 8;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeakPasswordError';
  }
}

export function assertPasswordStrength(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `كلمة المرور قصيرة. الحد الأدنى ${MIN_PASSWORD_LENGTH} محارف، والأطول أقوى من الأعقد.`,
    );
  }
  // argon2 يقبل مدخلات طويلة، لكن حدّاً أعلى يمنع استنزاف الذاكرة بطلب واحد
  if (Buffer.byteLength(plain, 'utf8') > 1024) {
    throw new WeakPasswordError('كلمة المرور أطول من الحد المسموح (1024 بايت).');
  }
}

export async function hashPassword(plain: string): Promise<string> {
  assertPasswordStrength(plain);
  return hash(plain, OPTIONS);
}

/**
 * يُرجع false ولا يرمي عند تلف التجزئة أو اختلاف صيغتها.
 * تجزئة تالفة يجب أن تعني «رفض الدخول»، لا «خطأ داخلي» يكشف وجود الحساب.
 */
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch {
    return false;
  }
}
