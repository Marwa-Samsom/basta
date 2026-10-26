/*
 * عامل الخدمة — المرحلة 12 (PWA، تصفّح جزئي بلا اتصال).
 *
 * ثلاث قواعد، وكل ما عداها يمرّ إلى الشبكة كما هو:
 *   1. ملفات البناء (/_next/static) لا تتغيّر تحت اسمها: من الذاكرة أولاً.
 *   2. صفحات المتجر: الشبكة أولاً، ونسخة آخر زيارة عند الانقطاع، ثم /offline —
 *      ما فُتح بتحميل كامل وما فُتح بالكبس على رابط داخل الموقع.
 *   3. صور المنتجات: من الذاكرة فوراً وتُحدَّث في الخلفية.
 * **لا يُخزَّن** أي ردّ للواجهة البرمجية ولا صفحات الحساب والسلة والدفع
 * واللوحتين: بيانات شخصية في ذاكرة جهاز مشترك تسريب، وسعر قديم في سلة خطأ.
 * وهذه عند الانقطاع تُظهر /offline أيضاً، لا خطأ المتصفّح (AUTH-086، 26 أكتوبر 2026).
 */
const VERSION = 'basta-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const IMAGES = `${VERSION}-images`;
const PRIVATE = /^\/(cart|checkout|orders|account|vendor|admin|login|register)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(['/offline', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.pathname.startsWith('/uploads/') && req.destination === 'image') {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(req);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // التنقّل بالكبس داخل الموقع: Next يطلب جزء الصفحة (rsc) لا الصفحة، فلا يمرّ بالتنقّل أدناه
  // ولا يُحفظ شيء — فمن تصفّح بالروابط ثم انقطع وجد /offline لما رآه قبل دقيقة. تُجلب الصفحة
  // كاملةً في الخلفية وتُحفظ؛ لما يُفتح فعلاً وحده، لا لما يجهّزه Next مسبقاً لكل رابط ظاهر
  if (
    req.headers.get('rsc') === '1' &&
    !req.headers.has('next-router-prefetch') &&
    !req.headers.has('next-router-segment-prefetch') &&
    !PRIVATE.test(url.pathname)
  ) {
    const page = new URL(url);
    page.searchParams.delete('_rsc');
    event.waitUntil(
      fetch(page, { credentials: 'same-origin' })
        .then((res) =>
          res.ok && (res.headers.get('content-type') || '').includes('text/html')
            ? caches.open(PAGES).then((c) => c.put(page.href, res))
            : undefined,
        )
        .catch(() => undefined),
    );
    return;
  }

  if (req.mode !== 'navigate') return;

  // الخاصة من الشبكة دائماً ولا تُحفظ. كانت تُترك للمتصفّح فيظهر خطؤه الإنجليزي عند الانقطاع
  if (PRIVATE.test(url.pathname)) {
    event.respondWith(fetch(req).catch(async () => (await caches.match('/offline')) || Response.error()));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // النسخة قبل تسليم الردّ: بعده يقرأ المتصفّح جسمه فلا يُنسخ — كان الحفظ يفشل صامتاً
        // فلا تُحفظ صفحة واحدة، و/offline تَعِد بما زاره الزائر ولا شيء منه
        if (res.ok) {
          const copy = res.clone();
          caches.open(PAGES).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (await caches.match('/offline'))),
  );
});
