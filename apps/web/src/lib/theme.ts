import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from './theme-colors';

/**
 * الوضع الداكن والفاتح — زرّ في رأس المتجر وشريط اللوحتين (17 أكتوبر 2026).
 *
 * بلا اختيار يتبع الصفحةُ نظامَ التشغيل كما كانت. الضغط يثبّت اختياراً صريحاً
 * في `data-theme` على `<html>` — tokens.css يقرؤه ويغلب به الوسيط — ويُحفظ في
 * المتصفّح فيبقى بين الزيارات.
 */
export type Theme = 'light' | 'dark';

const KEY = 'basta.theme';
const EVENT = 'basta:theme';

/**
 * يُطبَّق الاختيار المحفوظ قبل أول رسم (سكربت في رأس الصفحة): بدونه تومض
 * الصفحة بلون النظام ثم تنقلب بعد التحميل. ويلوّن شريط المتصفّح على الجوال
 * بالأرضية نفسها.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content',t==='dark'?'${THEME_COLOR_DARK}':'${THEME_COLOR_LIGHT}')})}}catch(e){}`;

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** الوضع الظاهر الآن: الاختيار الصريح، وإلا ما يقوله النظام */
export function currentTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return systemDark() ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', theme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // تخزين محجوب (تصفّح خاص): الوضع يتغيّر لهذه الصفحة ولا يُحفظ
  }
  window.dispatchEvent(new Event(EVENT));
}

/** لـ useSyncExternalStore: تغيّر الاختيار هنا، أو في تبويب آخر، أو تغيّر النظام */
export function subscribeTheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    if (e.newValue === 'light' || e.newValue === 'dark') setTheme(e.newValue);
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);
  mq.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    mq.removeEventListener('change', onChange);
  };
}
