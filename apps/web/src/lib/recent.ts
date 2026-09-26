import { useSyncExternalStore } from 'react';

/**
 * قوائم صغيرة في التخزين المحلي — «شوهد مؤخراً» (ST-24) وقائمة المقارنة (ST-10).
 *
 * على الجهاز لا في الخادم: تعمل للزائر بلا حساب، ولا تُرسل شيئاً عن تصفّحه.
 * كل وصول للتخزين داخل try/catch: النافذة الخاصة أو الموقع المحظور تخزينه
 * يرمي عند القراءة أو الكتابة. حينها تبقى القائمة في الذاكرة لهذه الجلسة —
 * تعمل الميزة ولا تُسقط الصفحة.
 *
 * والمخزَّن معرّف المنتج واسمه وصورته فقط، **لا السعر**: السعر المخزَّن يشيخ،
 * وعرضه بعد أسبوع كأنه السعر الحالي تضليل. الشاشات تجلبه حيّاً.
 */

const EMPTY: readonly never[] = Object.freeze([]);
const serverSnapshot = (): readonly never[] => EMPTY;

export interface LocalList<T> {
  read(): readonly T[];
  write(next: readonly T[]): void;
  subscribe(onChange: () => void): () => void;
}

export function localList<T>(key: string, isItem: (value: unknown) => value is T): LocalList<T> {
  const event = `${key}:change`;
  /** نسخة الذاكرة حين يرفض المتصفّح الكتابة */
  let memory: readonly T[] | null = null;
  /** نفس المرجع ما لم يتغيّر النصّ — useSyncExternalStore يعيد التصيير عند كل مرجع جديد */
  let cache: { raw: string | null; list: readonly T[] } | null = null;

  const parse = (raw: string | null): readonly T[] => {
    if (!raw) return EMPTY;
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isItem) : EMPTY;
    } catch {
      return EMPTY; // نصّ تالف: قائمة فارغة لا خطأ
    }
  };

  return {
    read() {
      if (typeof window === 'undefined') return EMPTY;
      if (memory) return memory;
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        return EMPTY;
      }
      if (cache && cache.raw === raw) return cache.list;
      cache = { raw, list: parse(raw) };
      return cache.list;
    },
    write(next) {
      if (typeof window === 'undefined') return;
      const list = Object.freeze([...next]);
      try {
        if (list.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(list));
        memory = null;
      } catch {
        memory = list;
      }
      window.dispatchEvent(new Event(event));
    },
    subscribe(onChange) {
      // تبويب آخر غيّر القائمة: حدث storage يصل هنا فيبقى العرض متّسقاً
      const onStorage = (e: StorageEvent): void => {
        if (e.key === key || e.key === null) onChange();
      };
      window.addEventListener(event, onChange);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(event, onChange);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
}

/** القائمة كما هي الآن، وفارغة في الخادم وأول تصيير — لا اختلاف ترطيب */
export function useLocalList<T>(list: LocalList<T>): readonly T[] {
  return useSyncExternalStore(list.subscribe, list.read, serverSnapshot);
}

const noop = (): (() => void) => () => undefined;

/**
 * false في الخادم وأول تصيير، ثم true. الشاشة التي كلها من التخزين المحلي
 * تعرض «جارٍ التحميل» حتى تقرأه، لا حالتها الفارغة لحظةً ثم القائمة.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

// ---------------------------------------------------------------- شوهد مؤخراً

/** سقف السجلّ — ما يكفي للعودة إلى ما تصفّحه اليوم وأمس */
export const RECENT_MAX = 20;

export interface RecentItem {
  slug: string;
  nameAr: string;
  /** مسار الصورة المصغّرة على خادم الرفع كما يعطيه المتجر */
  thumb: string | null;
  /** وقت آخر مشاهدة بالمللي ثانية */
  viewedAt: number;
}

const isRecent = (v: unknown): v is RecentItem => {
  const o = v as Partial<RecentItem> | null;
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.slug === 'string' &&
    o.slug.length > 0 &&
    typeof o.nameAr === 'string' &&
    (o.thumb === null || typeof o.thumb === 'string') &&
    typeof o.viewedAt === 'number'
  );
};

export const recentList = localList<RecentItem>('basta.recent', isRecent);

export const useRecent = (): readonly RecentItem[] => useLocalList(recentList);

/** يسجّل مشاهدة: الأحدث أولاً، بلا تكرار، وبسقف */
export function recordView(item: Omit<RecentItem, 'viewedAt'>): void {
  const rest = recentList.read().filter((x) => x.slug !== item.slug);
  recentList.write([{ ...item, viewedAt: Date.now() }, ...rest].slice(0, RECENT_MAX));
}

export function clearRecent(): void {
  recentList.write([]);
}
