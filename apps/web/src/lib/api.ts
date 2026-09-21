/**
 * عميل الواجهة البرمجية.
 *
 * ثلاثة أشياء يفعلها ولا يفعلها غيره:
 * 1. **رسالة الخطأ تأتي من الخادم كما هي.** الخادم يكتب رسائل عربية تقول ما
 *    حدث ولماذا وما التالي؛ استبدالها بـ «حدث خطأ» في الواجهة يهدر ذلك.
 * 2. **تجديد الرمز مرة واحدة عند 401** ثم إعادة الطلب — انتهاء صلاحية رمز
 *    الوصول أثناء ملء نموذج لا يجوز أن يُفقد ما كُتب.
 * 3. **الرموز في مكان واحد** (`session`)، فلا ينسخها كل استدعاء.
 */

/**
 * العنوان الافتراضي بـ `127.0.0.1` لا `localhost` عمداً: الخادم يسمع على
 * IPv4، والمتصفّح على ويندوز يترجم `localhost` إلى `::1` أولاً فيرتدّ الطلب
 * بـ ERR_CONNECTION_REFUSED بينما يعمل curl. العنوان الصريح لا يحتمل تأويلاً.
 */
export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1';

const ACCESS_KEY = 'basta.access';
const REFRESH_KEY = 'basta.refresh';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export const session = {
  read(): Tokens | null {
    if (typeof window === 'undefined') return null;
    const accessToken = window.localStorage.getItem(ACCESS_KEY);
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  },
  write(tokens: Tokens): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

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

  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(body !== undefined ? { body } : {}),
  });
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

function refresh(): Promise<Tokens | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const current = session.read();
    if (!current) return null;
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) {
      session.clear();
      return null;
    }
    const data = (await res.json()) as { tokens?: Tokens } & Partial<Tokens>;
    const tokens = data.tokens ?? (data as Tokens);
    session.write(tokens);
    return tokens;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const needsAuth = options.auth !== false;
  let token = needsAuth ? (session.read()?.accessToken ?? null) : null;

  let res = await raw(path, options, token);

  if (res.status === 401 && needsAuth) {
    const renewed = await refresh();
    if (renewed) {
      token = renewed.accessToken;
      res = await raw(path, options, token);
    }
  }

  if (!res.ok) throw await ApiError.from(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** ملف من الخادم بجلسة المستخدم — كشف الحساب CSV. التنزيل يبقى في المتصفّح */
export async function apiBlob(path: string): Promise<Blob> {
  let token = session.read()?.accessToken ?? null;
  let res = await raw(path, {}, token);
  if (res.status === 401) {
    const renewed = await refresh();
    if (renewed) {
      token = renewed.accessToken;
      res = await raw(path, {}, token);
    }
  }
  if (!res.ok) throw await ApiError.from(res);
  return res.blob();
}
