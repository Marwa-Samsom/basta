/**
 * اختبار الحِمل — المرحلة 12: ذروة طلبات متزامنة على السيناريو الحرج.
 *
 * السيناريو: عرض محدود — منتج بعشرين قطعة، ومئة مشترٍ يضغطون «ادفع» في
 * اللحظة نفسها. الصحيح الوحيد: عشرون طلباً مدفوعاً بالضبط، وثمانون يسمعون
 * «نفدت الكمية» قبل أي مال، والمخزون صفر لا سالب، والدفتر محفوظ بالقرش.
 * ثم موجة ثانية بمخزون وافر لقياس زمن الاستجابة تحت الضغط.
 *
 *   npm run probe:load            (الخادم على 4000)
 *   npm run probe:load -- 200 40  (مشترون، ومخزون)
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1';
const BUYERS = Number(process.argv[2] ?? 100);
const STOCK = Number(process.argv[3] ?? 20);
const prisma = new PrismaClient();
const TAG = `load${Date.now()}`;
const ADDRESS = { recipientName: 'مشترٍ حِمل', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' };

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const t = performance.now();
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms: performance.now() - t };
}

async function makeVariant(stock: number): Promise<string> {
  const user = await prisma.user.create({ data: { email: `${TAG}.${stock}@basta.test`, fullName: 'بائع الحِمل', passwordHash: 'x', roles: { create: { role: 'vendor_owner' } } } });
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: user.id, slug: `${TAG}-${stock}`, nameAr: `متجر حِمل ${stock}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_000n } } } },
    },
  });
  const product = await prisma.product.create({ data: { vendorId: vendor.id, slug: `${TAG}-p-${stock}`, nameAr: 'منتج العرض المحدود', status: 'active', publishedAt: new Date() } });
  const variant = await prisma.productVariant.create({ data: { productId: product.id, vendorId: vendor.id, sku: `${TAG}-${stock}`.toUpperCase(), priceMinorUnits: 9_900n, optionsKey: '', isActive: true } });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: stock, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: stock, reason: 'import' } });
  return variant.id;
}

/** مشترٍ كامل: سلة ← إضافة ← دفع. يعيد نتيجة الدفع وزمن كل خطوة */
async function buyer(variantId: string) {
  const t = performance.now();
  const cart = await post('/cart', { currency: 'SAR' });
  const token = cart.json.token as string;
  await post('/cart/items', { variantId, qty: 1 }, { 'x-cart-token': token });
  const pay = await post('/checkout', { address: ADDRESS, paymentToken: 'tok_success', guestEmail: 'load@basta.test' }, { 'x-cart-token': token, 'idempotency-key': randomUUID() });
  return { status: pay.status, outcome: pay.json.outcome as string | undefined, message: pay.json.message as string | undefined, checkoutMs: pay.ms, totalMs: performance.now() - t };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0);
};

async function views(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const v of ['audit_money_conservation', 'audit_wallet_drift', 'audit_inventory_drift', 'audit_reservation_drift', 'audit_order_split_drift', 'audit_paid_without_split', 'audit_sub_order_without_ledger']) {
    out[v] = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${v}"`))[0]!.n;
  }
  return out;
}

async function main(): Promise<void> {
  let failed = false;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? '✓' : '✗'} ${msg}`);
    if (!ok) failed = true;
  };

  // ------------------------------------------------ الموجة 1: العرض المحدود
  const scarce = await makeVariant(STOCK);
  console.log(`\nالموجة 1 — ${BUYERS} مشترٍ متزامن على ${STOCK} قطعة`);
  const t1 = performance.now();
  const r1 = await Promise.all(Array.from({ length: BUYERS }, () => buyer(scarce)));
  const wall1 = performance.now() - t1;
  const paid = r1.filter((r) => r.outcome === 'paid').length;
  const soldOut = r1.filter((r) => r.status === 409).length;
  const other = r1.filter((r) => r.outcome !== 'paid' && r.status !== 409);
  const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: scarce } });
  console.log(`   ${Math.round(wall1)}ms للموجة كلها · الدفع p50 ${pct(r1.map((r) => r.checkoutMs), 50)}ms · p95 ${pct(r1.map((r) => r.checkoutMs), 95)}ms`);
  check(paid === STOCK, `مدفوع ${paid} = المخزون ${STOCK} — لا بيع زائد ولا ناقص`);
  check(soldOut === BUYERS - STOCK, `${soldOut} سمعوا «نفدت الكمية» قبل أي مال`);
  check(other.length === 0, `لا نتيجة ثالثة${other.length ? ` (${other.map((o) => `${o.status}:${o.message}`).slice(0, 3).join(' | ')})` : ''}`);
  check(inv.onHand === 0 && inv.reserved === 0, `المخزون ${inv.onHand} والمحجوز ${inv.reserved} — لا سالب ولا حجز معلّق`);

  // ------------------------------------------------ الموجة 2: زمن تحت الضغط
  const plenty = await makeVariant(BUYERS * 2);
  console.log(`\nالموجة 2 — ${BUYERS} مشترٍ متزامن بمخزون وافر`);
  const t2 = performance.now();
  const r2 = await Promise.all(Array.from({ length: BUYERS }, () => buyer(plenty)));
  const wall2 = performance.now() - t2;
  const ok2 = r2.filter((r) => r.outcome === 'paid').length;
  const p95 = pct(r2.map((r) => r.checkoutMs), 95);
  console.log(`   ${Math.round(wall2)}ms · ${Math.round((ok2 / wall2) * 1000)} طلب مدفوع/ث · الدفع p50 ${pct(r2.map((r) => r.checkoutMs), 50)}ms · p95 ${p95}ms · p99 ${pct(r2.map((r) => r.checkoutMs), 99)}ms`);
  check(ok2 === BUYERS, `كل الـ${BUYERS} دُفعوا (${ok2})`);
  check(p95 < 3000, `زمن الدفع p95 تحت 3 ثوانٍ (${p95}ms)`);

  // ------------------------------------------------ السلامة بعد الموجتين
  const v = await views();
  check(Object.values(v).every((n) => n === 0), `منظرات التدقيق كلها صفر بعد الذروة ${JSON.stringify(v)}`);

  console.log(failed ? '\n✗ الحِمل كشف خللاً' : '\n✓ صمد السيناريو الحرج تحت الذروة');
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

void main();
