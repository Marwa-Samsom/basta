/**
 * مسبار LCP — بوابة المرحلة 12 البند الأول: LCP تحت 2.5 ثانية على شبكة جوال محاكاة.
 *
 * الظروف كما يحاكيها Lighthouse للجوال: شبكة «Slow 4G» (زمن 150ms، تنزيل
 * 1.6 ميغابت، رفع 750 كيلوبت) ومعالج أبطأ أربع مرات، وشاشة هاتف. يُقاس
 * أول تحميل **بلا ذاكرة** (زائر جديد) — الأسوأ لا الأفضل.
 *
 * يعمل على بناء الإنتاج (npm run build:probe -w @basta/web ثم serve:probe على 3100)
 * ويستعمل Chrome المثبّت على الجهاز — لا تنزيل متصفّح.
 *
 *   node scripts/probes/lcp-probe.mjs [http://127.0.0.1:3100] [عدد التكرار]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const RUNS = Number(process.argv[3] ?? 3);
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const BUDGET_MS = 2500;

// منتج بصورة إن وُجد (npm run demo:seed) — LCP بصورة منتج هو الأسوأ والأصدق
const demo = await fetch(`${API}/storefront/products/demo-linen-dress`).then((r) => (r.ok ? r.json() : null));
const firstProduct = await fetch(`${API}/storefront/products?pageSize=1`).then((r) => r.json());
const product = demo ?? firstProduct.items?.[0];

const pages = [
  ['الرئيسية', '/'],
  ['المتاجر', '/shops'],
  ...(product ? [['منتج', `/p/${encodeURIComponent(product.slug)}`], ['متجر', `/s/${encodeURIComponent(product.vendor.slug)}`]] : []),
  ['نتائج بحث', `/search?q=${encodeURIComponent('قميص')}`],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function measure(path) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    locale: 'ar',
    userAgent:
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__lcpEl = '';
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__lcp = e.startTime;
        window.__lcpEl = e.element ? `${e.element.tagName.toLowerCase()}${e.element.className ? '.' + String(e.element.className).split(' ')[0] : ''}` : '';
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(2500);
  // LCP يُحسم عند أول تفاعل — نقرة في فراغ تُثبّته كما يفعل Lighthouse
  const result = await page.evaluate(() => ({ lcp: window.__lcp, el: window.__lcpEl, ttfb: performance.getEntriesByType('navigation')[0]?.responseStart ?? 0 }));
  await context.close();
  return { status: res?.status() ?? 0, ...result };
}

const rows = [];
for (const [name, path] of pages) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(path));
  const sorted = [...runs].sort((a, b) => a.lcp - b.lcp);
  const median = sorted[Math.floor(sorted.length / 2)];
  rows.push({ name, path, status: median.status, lcp: Math.round(median.lcp), ttfb: Math.round(median.ttfb), el: median.el, worst: Math.round(sorted.at(-1).lcp) });
}
await browser.close();

let failed = false;
console.log(`\nLCP على «Slow 4G» + معالج ×4، هاتف 412×823، بلا ذاكرة — وسيط ${RUNS} تحميلات\n`);
for (const r of rows) {
  const ok = r.status === 200 && r.lcp > 0 && r.lcp < BUDGET_MS;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${r.name.padEnd(10)} LCP ${String(r.lcp).padStart(5)}ms (أسوأ ${r.worst}) · TTFB ${r.ttfb}ms · ${r.el} · ${r.status}`);
}
console.log(failed ? `\n✗ صفحة تتجاوز ${BUDGET_MS}ms` : `\n✓ كل الصفحات تحت ${BUDGET_MS}ms`);
process.exit(failed ? 1 : 0);
