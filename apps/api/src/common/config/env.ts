/**
 * التحقق من المتغيّرات عند الإقلاع — لا أثناء أول طلب.
 *
 * سرّ توقيع غائب لا يجوز أن يمرّ كـ `undefined` فيوقّع التطبيق رموزاً
 * بسرّ فارغ. الخيار الصحيح أن يرفض التطبيق الإقلاع أصلاً: عطل صاخب
 * وقت النشر أهون ألف مرة من ثغرة صامتة في الإنتاج.
 */
export class EnvError extends Error {
  constructor(missing: string[]) {
    super(
      `متغيّرات بيئة ناقصة: ${missing.join('، ')}. ` +
        `انسخ .env.example إلى .env واملأها قبل التشغيل.`,
    );
    this.name = 'EnvError';
  }
}

const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

export interface Env {
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessTtl: string;
  jwtRefreshTtl: string;
  nodeEnv: string;
}

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) throw new EnvError([...missing]);

  // الأسرار القصيرة قابلة للكسر بالقوة الغاشمة — ترفض في الإنتاج لا تُقبل بتحذير
  if (process.env.NODE_ENV === 'production') {
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if ((process.env[k] ?? '').length < 32) {
        throw new EnvError([`${k} (أقصر من 32 محرفاً)`]);
      }
    }
  }

  cached = {
    databaseUrl: process.env['DATABASE_URL'] as string,
    jwtAccessSecret: process.env['JWT_ACCESS_SECRET'] as string,
    jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'] as string,
    jwtAccessTtl: process.env['JWT_ACCESS_TTL'] ?? '15m',
    jwtRefreshTtl: process.env['JWT_REFRESH_TTL'] ?? '30d',
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
  };
  return cached;
}

/** للاختبارات التي تبدّل البيئة بين الحالات. */
export const resetEnvCache = (): void => {
  cached = null;
};
