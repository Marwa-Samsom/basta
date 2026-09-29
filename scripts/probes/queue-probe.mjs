// تجربة طابور على PostgreSQL بديلاً عن Redis/BullMQ — بوابة المرحلة 08
import { PgBoss } from 'pg-boss';
import pg from 'pg';

// الاتصال من البيئة (مالك المخطط) — لا كلمة مرور مكتوبة هنا
const URL = process.env.DATABASE_MIGRATE_URL;
if (!URL) throw new Error('اضبط DATABASE_MIGRATE_URL (npx dotenv -e .env -- node …)');
const boss = new PgBoss({ connectionString: URL, schema: 'queue_probe' });
boss.on('error', (e) => console.error('خطأ الطابور:', e.message));
await boss.start();
console.log('الطابور قام على مخطّط queue_probe داخل قاعدة بسطة نفسها — بلا خدمة إضافية');

// 1) مهمة عادية
await boss.createQueue('order.paid');
const done = [];
await boss.work('order.paid', async ([job]) => { done.push(job.data.orderId); });
const id = await boss.send('order.paid', { orderId: 'ORD-1001' });
console.log('1) إرسال واستهلاك: مهمة', id.slice(0, 8));

// 2) إعادة المحاولة بعد فشل
await boss.createQueue('flaky', { retryLimit: 3, retryDelay: 1 });
let attempts = 0;
await boss.work('flaky', async () => {
  attempts++;
  if (attempts < 3) throw new Error('فشل مقصود');
});
await boss.send('flaky', {});

// 3) إدراج داخل معاملة قاعدة البيانات — الميزة التي لا يعطيها Redis
const client = new pg.Client(URL);
await client.connect();
await client.query('BEGIN');
const tx = { async executeSql(text, values) { return client.query(text, values); } };
await boss.send('order.paid', { orderId: 'ORD-ROLLBACK' }, { db: tx });
await client.query('ROLLBACK');

await client.query('BEGIN');
await boss.send('order.paid', { orderId: 'ORD-COMMIT' }, { db: tx });
await client.query('COMMIT');
await client.end();

// 4) جدولة دورية (تسوية كل 10 دقائق في الخطة)
await boss.createQueue('settlement');
let cronRuns = 0;
await boss.work('settlement', async () => { cronRuns++; });
await boss.schedule('settlement', '* * * * *'); // كل دقيقة للتجربة
const schedules = await boss.getSchedules();

await new Promise((r) => setTimeout(r, 12000));

console.log('2) إعادة المحاولة: نجحت بعد', attempts, 'محاولات (الحدّ 3)');
console.log('3) داخل المعاملة: المنفَّذ =', JSON.stringify(done.filter((o) => o.startsWith('ORD-'))));
console.log('   المتوقّع: ORD-1001 و ORD-COMMIT فقط — ORD-ROLLBACK تراجع مع المعاملة ولم يصل أبداً');
console.log('4) الجدولة الدورية:', schedules.map((s) => `${s.name} @ ${s.cron}`).join(', '));

const c2 = new pg.Client(URL);
await c2.connect();
const { rows } = await c2.query(`select state, count(*)::int from queue_probe.job group by state order by 2 desc`);
console.log('5) حالات المهام في الجدول:', rows.map((r) => `${r.state}=${r.count}`).join(' · '));
await c2.query('drop schema if exists queue_probe cascade');
await c2.end();
await boss.stop({ graceful: false });
console.log('نُظّف مخطّط التجربة.');
process.exit(0);
