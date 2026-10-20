import type { Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { deflateSync } from 'node:zlib';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';

/**
 * تجهيز الاختبار: الحسابات تُنشأ من مسار التسجيل العام نفسه (كلمة المرور
 * تُجزَّأ كما في الإنتاج)، ثم تُعدَّل أدوارها في القاعدة — الاختبار يمرّ
 * بالواجهة في كل ما يفعله المستخدم، ويختصر ما يسبق وجوده (بائع معتمد، مدير).
 */
export const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1';
export const PASSWORD = 'e2e-كلمة-مرور-طويلة-1';
export const prisma = new PrismaClient();
const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

export const tag = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function register(email: string, fullName: string): Promise<string> {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName }),
  });
  if (!res.ok) throw new Error(`تسجيل ${email}: ${res.status} ${await res.text()}`);
  return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

/** مشترٍ بحساب، داخلٌ في هذه الصفحة من نموذج الدخول نفسه — الشراء بحساب */
export async function signInBuyer(page: Page, t = tag()): Promise<{ email: string; userId: string }> {
  const email = `buyer.${t}@basta.test`;
  const userId = await register(email, `مشترٍ ${t}`);
  await page.goto('/login?next=/account');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/account');
  return { email, userId };
}

export async function makeVendor(t: string) {
  const email = `vendor.${t}@basta.test`;
  const userId = await register(email, `بائع ${t}`);
  await prisma.userRole.create({ data: { userId, role: 'vendor_owner' } });
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: userId, slug: `store-${t}`, nameAr: `متجر ${t}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      bankAccounts: { create: { holderName: `بائع ${t}`, iban: 'SA0380000000608010167519', bankName: 'بنك تجريبي', isDefault: true, verifiedAt: new Date() } },
    },
  });
  // المتجر يبدأ بالفئات الثماني المقترحة (مشغِّل القاعدة)، ولا منتج بلا فئة
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: vendor.id }, orderBy: { sort: 'asc' } });
  const product = await prisma.product.create({
    data: { vendorId: vendor.id, vendorCategoryId: category.id, slug: `product-${t}`, nameAr: `منتج اختبار ${t}`, descriptionAr: 'منتج لاختبار E2E.', status: 'active', publishedAt: new Date() },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, vendorId: vendor.id, sku: `E2E-${t}`.toUpperCase(), priceMinorUnits: 25_000n, optionsKey: '', isActive: true },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: 10, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 10, reason: 'import' } });
  return { email, userId, vendorId: vendor.id, productSlug: product.slug, productName: product.nameAr, variantId: variant.id };
}

export async function makeAdmin(t: string, permissions: readonly string[] = ['payouts.approve', 'reports.view']) {
  const email = `admin.${t}@basta.test`;
  const userId = await register(email, `مدير ${t}`);
  const secret = generateSecret();
  await prisma.userRole.create({ data: { userId, role: 'admin' } });
  await prisma.adminPermission.createMany({ data: permissions.map((permission) => ({ userId, permission })) });
  await prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: secret, totpEnabledAt: new Date() } });
  return { email, totp: () => generateSync({ strategy: 'totp', secret, crypto, base32 }) };
}

export async function auditViews(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const v of ['audit_money_conservation', 'audit_wallet_drift', 'audit_withdrawn_drift', 'audit_inventory_drift', 'audit_order_split_drift']) {
    out[v] = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${v}"`))[0]!.n;
  }
  return out;
}

/** PNG بلون واحد بلا مكتبة — يكفي الخادم ليقرأه ويعيد كتابته */
export function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 بت، RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
