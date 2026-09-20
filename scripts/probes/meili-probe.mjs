// تجربة البحث العربي على Meilisearch محمول — بوابة المرحلة 07
const HOST = 'http://127.0.0.1:7701';
const KEY = 'basta_local_dev_key_0001';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };

const api = async (path, init = {}) => {
  const res = await fetch(HOST + path, { ...init, headers: H });
  return res.json();
};

const nouns = ['قميص', 'بنطال', 'فستان', 'حذاء', 'حقيبة', 'ساعة', 'هاتف', 'حاسوب', 'سمّاعة', 'شاحن', 'طاولة', 'كرسي', 'مصباح', 'سجّادة', 'وسادة', 'عطر', 'كريم', 'شامبو', 'نظّارة', 'محفظة'];
const adjs = ['قطني', 'جلدي', 'رياضي', 'كلاسيكي', 'صيفي', 'شتوي', 'فاخر', 'يومي', 'خفيف', 'مقاوم للماء'];
const brands = ['دار القطن', 'أحمد وأولاده', 'إبداع', 'آفاق', 'المصنع الأردني', 'بيت الأناقة', 'نسيج', 'الشرق'];
const colors = ['أسود', 'أبيض', 'أزرق', 'أحمر', 'بيج', 'رمادي'];

const docs = [];
for (let i = 1; i <= 10000; i++) {
  const n = nouns[i % nouns.length];
  const a = adjs[(i * 7) % adjs.length];
  const b = brands[(i * 3) % brands.length];
  const c = colors[(i * 5) % colors.length];
  docs.push({
    id: i,
    nameAr: `${n} ${a} ${c} من ${b}`,
    nameEn: `product ${i}`,
    brand: b,
    category: i % 3 === 0 ? 'أزياء' : i % 3 === 1 ? 'إلكترونيات' : 'منزل',
    priceMinor: 1000 + (i % 900) * 100,
  });
}
// بذرة مقصودة لاختبار الهمزات: اسم بهمزة قطع صريحة
docs.push({ id: 10001, nameAr: 'عطر أحمد الملكي', nameEn: 'ahmad royal', brand: 'أحمد وأولاده', category: 'أزياء', priceMinor: 45000 });
docs.push({ id: 10002, nameAr: 'إسورة فضية', nameEn: 'silver bracelet', brand: 'إبداع', category: 'أزياء', priceMinor: 12000 });

const t0 = Date.now();
await api('/indexes', { method: 'POST', body: JSON.stringify({ uid: 'products_probe', primaryKey: 'id' }) });
await api('/indexes/products_probe/settings', {
  method: 'PATCH',
  body: JSON.stringify({
    searchableAttributes: ['nameAr', 'brand', 'category', 'nameEn'],
    filterableAttributes: ['category', 'brand', 'priceMinor'],
    sortableAttributes: ['priceMinor'],
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
  }),
});
const task = await api('/indexes/products_probe/documents', { method: 'POST', body: JSON.stringify(docs) });

// انتظار انتهاء الفهرسة
let status = '';
for (let i = 0; i < 300; i++) {
  const t = await api(`/tasks/${task.taskUid}`);
  status = t.status;
  if (status === 'succeeded' || status === 'failed') break;
  await new Promise((r) => setTimeout(r, 200));
}
const indexMs = Date.now() - t0;
console.log(`فهرسة ${docs.length} منتجاً: ${status} في ${indexMs} مللي ثانية`);

const cases = [
  ['احمد', 'همزة محذوفة — يجب أن يجد «أحمد»'],
  ['أحمد', 'همزة قطع كاملة'],
  ['اسورة', 'همزة محذوفة — يجب أن يجد «إسورة»'],
  ['قمييص', 'خطأ إملائي — حرف مكرر'],
  ['بنطلون', 'كلمة قريبة من «بنطال»'],
  ['سماعة', 'شدّة محذوفة — يجب أن يجد «سمّاعة»'],
  ['هاتف ازرق', 'كلمتان مع همزة محذوفة'],
  ['سجادة', 'شدّة محذوفة'],
  ['نظارة شمسية', 'كلمة زائدة غير موجودة'],
  ['dar alqutn', 'بحث لاتيني على علامة عربية'],
];

console.log('\nالنتائج — أول نتيجة وزمن الخادم:');
const times = [];
for (const [q, why] of cases) {
  const runs = [];
  let first = null;
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const r = await api('/indexes/products_probe/search', { method: 'POST', body: JSON.stringify({ q, limit: 5 }) });
    runs.push(r.processingTimeMs);
    first = r.hits[0]?.nameAr ?? '—';
    total = r.estimatedTotalHits ?? 0;
  }
  const med = runs.sort((a, b) => a - b)[2];
  times.push(med);
  console.log(`  «${q}» → ${total} نتيجة · ${med}ms · أول نتيجة: ${first}   (${why})`);
}
console.log(`\nأعلى زمن وسيط: ${Math.max(...times)}ms — البوابة تشترط أقل من 100ms`);

// فلترة وترتيب — يحتاجهما المتجر
const f = await api('/indexes/products_probe/search', {
  method: 'POST',
  body: JSON.stringify({ q: 'قميص', filter: 'category = "أزياء" AND priceMinor < 50000', sort: ['priceMinor:asc'], limit: 3 }),
});
console.log(`فلترة + ترتيب: ${f.estimatedTotalHits} نتيجة · ${f.processingTimeMs}ms · أرخص: ${f.hits[0]?.nameAr} (${f.hits[0]?.priceMinor})`);

const stats = await api('/indexes/products_probe/stats');
console.log(`حجم الفهرس: ${stats.numberOfDocuments} وثيقة`);
