import { localStore } from './storage';

/**
 * عميل الواجهة البرمجية.
 *
 * ثلاثة أشياء يفعلها ولا يفعلها غيره:
 * 1. **رسالة الخطأ تأتي من الخادم كما هي.** الخادم يكتب رسائل عربية تقول ما
 *    حدث ولماذا وما التالي؛ استبدالها بـ «حدث خطأ» في الواجهة يهدر ذلك.
 * 2. **تجديد الرمز مرة واحدة عند 401** ثم إعادة الطلب — انتهاء صلاحية رمز
 *    الوصول أثناء ملء نموذج لا يجوز أن يُفقد ما كُتب.
 * 3. **الرموز في مكان واحد** (`session`)، فلا ينسخها كل استدعاء.
 *
 * رمز الوصول وحده في localStorage — عمره ربع ساعة ويُفحص مع القاعدة في كل طلب.
 * رمز التحديث (ثلاثون يوماً) كوكي HttpOnly يضعه الخادم ولا يراه سكربت هنا أبداً:
 * ثغرة XSS تأخذ ربع ساعة على الأكثر لا جلسة شهر.
 */

/**
 * العنوان الافتراضي بـ `127.0.0.1` لا `localhost` عمداً: الخادم يسمع على
 * IPv4، والمتصفّح على ويندوز يترجم `localhost` إلى `::1` أولاً فيرتدّ الطلب
 * بـ ERR_CONNECTION_REFUSED بينما يعمل curl. العنوان الصريح لا يحتمل تأويلاً.
 */
export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1';

/**
 * عنوان الـ API لمن يطلب. المتصفّح يطلب من نطاق الواجهة نفسه (/api/v1، يمرّره
 * خادم الواجهة — app/api/v1/[...path]/route.ts): كوكي التحديث SameSite=Strict
 * لا يُرسل إلا إلى «الموقع» الذي فُتحت منه الصفحة، والواجهة والـ API نطاقان
 * مختلفان في الإنتاج المجاني وفي التطوير (localhost:3000 و 127.0.0.1:4000).
 * والخادم (تصيير الصفحات) يكلّم الـ API مباشرةً — لا كوكي هناك.
 */
export function apiBase(): string {
  return typeof window === 'undefined' ? API_BASE : '/api/v1';
}

/**
 * مسار ملف من خادم الرفع (`/uploads/…?s=…`) عنواناً كاملاً. الصور لا تمرّ بممرّ
 * /api/v1: لا كوكي فيها، وتُحمَّل من أصل الـ API مباشرةً (img-src في proxy.ts).
 */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${API_BASE.replace(/\/api\/v1\/?$/, '')}${path}`;
}

const ACCESS_KEY = 'basta.access';
/** كان رمز التحديث يُحفظ هنا — يُمسح من كل متصفّح بقي فيه */
const LEGACY_REFRESH_KEY = 'basta.refresh';

export interface Tokens {
  accessToken: string;
}

export const session = {
  read(): Tokens | null {
    if (typeof window === 'undefined') return null;
    localStore.remove(LEGACY_REFRESH_KEY);
    const accessToken = localStore.get(ACCESS_KEY);
    return accessToken ? { accessToken } : null;
  },
  write(tokens: Tokens): void {
    if (typeof window === 'undefined') return;
    localStore.set(ACCESS_KEY, tokens.accessToken);
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    localStore.remove(ACCESS_KEY);
    localStore.remove(LEGACY_REFRESH_KEY);
  },
  /**
   * أدوار الرمز الحالي — قراءة بلا تحقق من التوقيع، لقرارات العرض وحدها
   * (أيّ نصّ وأيّ وجهة). الخادم يفحص كل صلاحية بنفسه في كل طلب.
   */
  roles(): string[] {
    const roles = claims()?.['roles'];
    return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
  },
  /** صاحب الرمز الحالي (sub) — لما يُحفظ في المتصفّح باسمه، فلا يراه حساب آخر يدخل التبويب نفسه */
  userId(): string | null {
    const sub = claims()?.['sub'];
    return typeof sub === 'string' ? sub : null;
  },
};

/** حمولة رمز الوصول بلا تحقق من التوقيع — للعرض وحده */
function claims(): Record<string, unknown> | null {
  const access = session.read()?.accessToken;
  if (!access) return null;
  try {
    const payload = access.split('.')[1] ?? '';
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** خطأ يحمل ما قاله الخادم: الرسالة والرمز والتفاصيل (ومنها قائمة الموانع). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** أخطاء التحقق تأتي مصفوفة رسائل من ValidationPipe */
  static async from(res: Response): Promise<ApiError> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return new ApiError(res.status, 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    }
    const data = body as {
      message?: string | string[];
      code?: string;
      details?: Record<string, unknown>;
    };
    const message = Array.isArray(data.message)
      ? data.message.join(' · ')
      : (data.message ?? 'تعذّر إتمام الطلب.');
    return new ApiError(res.status, message, data.code ?? null, data.details ?? null);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** ملف: يُرسل multipart بلا ترويسة نوع يدوية — المتصفّح يضع الحدّ الفاصل */
  file?: File;
  auth?: boolean;
  /** ترويسات إضافية — رمز السلة ومفتاح عدم التكرار */
  headers?: Record<string, string>;
}

async function raw(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;

  if (options.file) {
    const form = new FormData();
    form.append('file', options.file);
    body = form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (token) headers['authorization'] = `Bearer ${token}`;
  // لغة الصفحة لا لغة المتصفّح: رسائل الخادم بلغة زرّ اللغة (lib/i18n)
  if (typeof document !== 'undefined') headers['accept-language'] ??= document.documentElement.lang || 'ar';

  // same-origin: الطلب إلى نطاق الواجهة نفسه، فيذهب كوكي التحديث ويُحفظ ما يضعه الردّ
  try {
    return await fetch(`${apiBase()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body } : {}),
    });
  } catch {
    // انقطاع الشبكة يرفض fetch بـ TypeError «Failed to fetch» — كانت تُعرض للمشتري كما هي.
    // الحالة 0 ليست رفضاً قاطعاً (checkout-attempt): «ادفع» ثانيةً يعيد الطلب نفسه
    throw new ApiError(0, NETWORK_MESSAGE, 'NETWORK');
  }
}

const NETWORK_MESSAGE = 'لا اتصال بالخادم — تحقّق من الشبكة وأعد المحاولة.';

/**
 * الجلسة انتهت ولم يجدّدها رمز التحديث — يسمعه SessionExpiredRedirect في الجذر فيعيد
 * صاحبها إلى الدخول ثم إلى الصفحة نفسها. لا يُطلق إلا لمن كان داخلاً: 401 لزائر (كلمة
 * مرور خاطئة عند الدخول) ردّ عادي يُعرض في مكانه.
 */
export const SESSION_EXPIRED_EVENT = 'basta:session-expired';

function backToLogin(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/**
 * تجديد واحد في كل لحظة.
 *
 * رمز التحديث يُستعمل **مرة واحدة** ويُدوَّر، وإعادة استعماله تُقرأ في الخادم
 * محاولةَ سرقة فتُلغى الجلسة كلها. ولوحة تطلق ستة طلبات متوازية تنتهي
 * صلاحيتها معاً كانت تطلق ستة تجديدات بالرمز نفسه — فيَنجح الأول وتُسقِط
 * البقيةُ الجلسةَ. الوعد المشترك هنا يجعل الخمسة الباقية تنتظر نتيجة الأول.
 */
let inFlight: Promise<Tokens | null> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * والتبويبات تتشارك كوكي التحديث ورمز الوصول، فوعد التبويب الواحد لا يكفي: قفل
 * باسم واحد (Web Locks) يسلسل التجديد بينها. من يدخل القفل ثانياً يجد أن
 * رمز الوصول تغيّر عمّا رآه حين فشل طلبه — جدّده أخوه — فيأخذه ولا يجدّد ثانيةً.
 * ومتصفّح بلا Web Locks يسمع من الخادم 409 «جُدّد للتوّ» فينتظر ما يكتبه أخوه.
 * رمز التحديث نفسه لا يُقرأ هنا: الكوكي يذهب ويعود وحده.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // نوع lib.dom يلفّ ردّ الدالة غير المتزامنة بوعد ثانٍ؛ القفل يعيد قيمتها المنتظَرة فعلاً
  return locks ? (locks.request('basta.refresh', fn) as unknown as Promise<T>) : fn();
}

function refresh(seen: string | null): Promise<Tokens | null> {
  if (inFlight) return inFlight;

  inFlight = withRefreshLock(async () => {
    const current = session.read();
    if (!current) return null;
    // تبويب آخر جدّد بعد أن فشل طلبنا وقبل أن ندخل القفل
    if (seen && current.accessToken !== seen) return current;
    // انقطاع الشبكة أثناء التجديد لا يمسّ الجلسة: يُرمى كخطأ اتصال لا «Failed to fetch»
    const res = await fetch(`${apiBase()}/auth/refresh`, { method: 'POST', credentials: 'same-origin' }).catch(() => {
      throw new ApiError(0, NETWORK_MESSAGE, 'NETWORK');
    });
    if (res.status === 409) {
      // دوّره تبويب آخر في اللحظة نفسها — الجلسة سليمة، وخلفه يُكتب الآن
      for (let i = 0; i < 20; i++) {
        const now = session.read();
        if (!now) return null;
        if (now.accessToken !== current.accessToken) return now;
        await sleep(100);
      }
      // لم يكتب أحد خلفاً: ضاع ردّ التجديد الأول في الطريق (انقطاع، إغلاق، إعادة
      // تحميل) والخادم دوّر الرمز. البقاء على رمز ميت أسوأ من دخول جديد
      session.clear();
      return null;
    }
    // الخادم نائم أو متعطّل (5xx، ومنها 502 من خادم الواجهة) ليس رفضاً للجلسة: كانت
    // تُمسح فيخرج كل من صادف استيقاظ الخادم المجاني. المسح لرفض رمز التحديث وحده
    if (res.status >= 500) throw await ApiError.from(res);
    if (!res.ok) {
      session.clear();
      return null;
    }
    const tokens = (await res.json()) as Tokens;
    session.write({ accessToken: tokens.accessToken });
    return session.read();
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const needsAuth = options.auth !== false;
  const before = needsAuth ? session.read() : null;
  let token = before?.accessToken ?? null;

  let res = await raw(path, options, token);

  if (res.status === 401 && needsAuth) {
    const renewed = await refresh(before?.accessToken ?? null);
    if (renewed) {
      token = renewed.accessToken;
      res = await raw(path, options, token);
    } else if (before) {
      // كان داخلاً والتجديد فشل: الجلسة ماتت (refresh مسحها) — لا 401 من منطق الصفحة
      backToLogin();
      throw new ApiError(401, 'انتهت جلستك — ادخل من جديد لتكمل.', 'SESSION_EXPIRED');
    }
  }

  if (!res.ok) throw await ApiError.from(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * الخروج — الخادم أولاً: يُبطل رمز التحديث ويمسح كوكيه، فيسقط رمز الوصول معه
 * في الطلب التالي (يُفحص مع القاعدة). المسح المحلي وحده كان يُخفي الجلسة عن
 * الواجهة ويتركها حيّة ثلاثين يوماً على جهاز قد يكون مشتركاً.
 *
 * تعذّر الطلب يُرمى ولا يُمسح شيء: جهاز يظنّ صاحبه أنه خرج وجلسته حيّة أسوأ
 * من رسالة تقول «حاول مرة أخرى».
 */
export async function logout(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'تعذّر الخروج — لا اتصال بالخادم. تحقّق من الشبكة وحاول مرة أخرى.');
  }
  if (!res.ok) throw await ApiError.from(res);
  session.clear();
}

/** ملف من الخادم بجلسة المستخدم — كشف الحساب CSV. التنزيل يبقى في المتصفّح */
export async function apiBlob(path: string): Promise<Blob> {
  const before = session.read();
  let token = before?.accessToken ?? null;
  let res = await raw(path, {}, token);
  if (res.status === 401) {
    const renewed = await refresh(before?.accessToken ?? null);
    if (renewed) {
      token = renewed.accessToken;
      res = await raw(path, {}, token);
    }
  }
  if (!res.ok) throw await ApiError.from(res);
  return res.blob();
}
