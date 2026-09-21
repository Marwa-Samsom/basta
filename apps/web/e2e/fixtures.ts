import { PrismaClient } from '@prisma/client';
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

export async function makeVendor(t: string) {
  const email = `vendor.${t}@basta.test`;
  const userId = await register(email, `بائع ${t}`);
  await prisma.userRole.create({ data: { userId, role: 'vendor_owner' } });
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: userId, slug: `store-${t}`, nameAr: `متجر ${t}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      bankAccounts: { create: { holderName: `بائع ${t}`, iban: 'SA0380000000608010167519', bankName: 'بنك تجريبي', isDefault: true } },
    },
  });
  const product = await prisma.product.create({
    data: { vendorId: vendor.id, categoryId: category.id, slug: `product-${t}`, nameAr: `منتج اختبار ${t}`, descriptionAr: 'منتج لاختبار E2E.', status: 'active', publishedAt: new Date() },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, vendorId: vendor.id, sku: `E2E-${t}`.toUpperCase(), priceMinorUnits: 25_000n, optionsKey: '', isActive: true },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: 10, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 10, reason: 'import' } });
  return { email, userId, vendorId: vendor.id, productSlug: product.slug, productName: product.nameAr, variantId: variant.id };
}

export async function makeAdmin(t: string) {
  const email = `admin.${t}@basta.test`;
  const userId = await register(email, `مدير ${t}`);
  const secret = generateSecret();
  await prisma.userRole.create({ data: { userId, role: 'admin' } });
  await prisma.adminPermission.createMany({ data: ['payouts.approve', 'reports.view'].map((permission) => ({ userId, permission })) });
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
