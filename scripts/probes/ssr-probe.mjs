// بوابة المرحلة 07 · البند الرابع: صفحة المنتج كاملة في مصدر HTML قبل JavaScript.
//
// يطلب الصفحة كما يطلبها زاحف محرّك بحث: GET خام، بلا متصفّح ولا تنفيذ سكربت.
// ثم يفحص أن الاسم والسعر والبائع والوصف موجودة في النصّ المُرسَل نفسه.
//
//   node scripts/probes/ssr-probe.mjs            (الخادم على 4000 والواجهة على 3000)

const API = process.env.API ?? 'http://127.0.0.1:4000/api/v1';
const WEB = process.env.WEB ?? 'http://localhost:3000';

const list = await (await fetch(`${API}/storefront/products?pageSize=24&sort=newest`)).json();
const withDescription = list.items.length ? list.items : [];
if (withDescription.length === 0) {
  console.error('لا منتجات منشورة — انشر منتجاً أولاً.');
  process.exit(2);
}

let failures = 0;
for (const card of withDescription.slice(0, 3)) {
  const product = await (await fetch(`${API}/storefront/products/${encodeURIComponent(card.slug)}`)).json();
  const res = await fetch(`${WEB}/p/${encodeURIComponent(card.slug)}`, {
    headers: { 'user-agent': 'basta-ssr-probe (no-js)' },
  });
  const html = await res.text();

  // النصّ المرئي بلا وسوم: ما يقرؤه الزاحف
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

  const checks = [
    ['الاسم', product.nameAr],
    ['السعر', product.priceFrom.formatted],
    ['البائع', product.vendor.nameAr],
    ...(product.descriptionAr ? [['الوصف', product.descriptionAr.slice(0, 40)]] : []),
  ];

  console.log(`\n${product.nameAr} — HTTP ${res.status}, ${html.length} بايت`);
  // الطرفان يُطبَّعان بالقاعدة نفسها: السعر المنسَّق يحمل فراغاً غير قاطع وعلامات
  // اتجاه (RLM)، وتطبيع النصّ وحده دون القيمة يجعل المسبار يكذب بالفشل
  const norm = (v) => v.replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();
  const haystack = norm(text);
  for (const [label, value] of checks) {
    // خارج <script>: وجوده في حمولة RSC وحدها لا يكفي، الزاحف يقرأ النصّ
    const ok = haystack.includes(norm(value));
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${value}`);
  }
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const titleOk = title.includes(product.nameAr);
  if (!titleOk) failures++;
  console.log(`  ${titleOk ? '✓' : '✗'} العنوان: ${title}`);
}

console.log(failures === 0 ? '\n✅ الصفحات كاملة في مصدر HTML' : `\n✗ ${failures} عنصراً غائباً`);
process.exit(failures === 0 ? 0 : 1);
