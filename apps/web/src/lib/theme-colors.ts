/**
 * لونا الأرضية — الاستثناء الوحيد من قاعدة «لا لون صريح خارج tokens.css».
 *
 * `viewport.themeColor` في Next.js يلوّن شريط المتصفّح على الجوال، ويُقرأ
 * قبل تحميل أي CSS — فلا يستطيع قراءة متغيّر. القيمة هنا **نسخة من**
 * `--surface-page` في السمتين، ومكانها الوحيد هذا الملف.
 *
 * عند تغيير `--surface-page` في src/styles/tokens.css غيّرها هنا أيضاً.
 * الملف مستثنى صراحةً من حارس الألوان في CI لهذا السبب وحده.
 */
export const THEME_COLOR_LIGHT = '#F8F3EC'; // = --surface-page (beige-50)
export const THEME_COLOR_DARK = '#14100D'; // = --surface-page (beige-950)
