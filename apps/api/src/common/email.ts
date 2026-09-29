import { Transform } from 'class-transformer';

/**
 * البريد مفتاح الحساب، والبريد لا يفرّق بين الحروف الكبيرة والصغيرة عملياً:
 * Victim@x.com و victim@x.com صندوق واحد. كان يُخزَّن ويُبحث كما كُتب، فيصيران
 * حسابين — ومن سجّل الثاني يستقبل رموز الاستعادة لصندوق غيره ويبدو صاحبه.
 *
 * صيغة واحدة في كل مدخل (الـ DTO بـ NormalizeEmail والخدمة بـ normalizeEmail)،
 * وقيد في القاعدة يرفض غيرها (مهاجرة normalize_user_emails) — فيصير فهرس
 * البريد الفريد فريداً بلا اعتبار للحروف.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/** يوحّد البريد قبل التحقق منه — ValidationPipe يطبّق التحويل أولاً (transform: true) */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value));
