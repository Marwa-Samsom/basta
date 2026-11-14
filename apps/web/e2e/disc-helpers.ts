import { expect } from '@playwright/test';
import { API, PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * تجهيز حالات «التصفّح والبحث» (DISC) في المتصفّح: متجر ومنتجات بالقاعدة، ثم فهرستها من
 * مسار البائع نفسه (حفظ المنتج يزامن الفهرس) — البحث بكلمة يمرّ بالمحرّك لا بالقاعدة.
 */

/** كلمة لاتينية عشوائية بلا أرقام — تحصر البحث في منتجات الاختبار وحدها */
export const word = (): string => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

export interface Shop {
  t: string;
  email: string;
  vendorId: string;
  slug: string;
  nameAr: string;
  categoryId: string;
  /** منتج makeVendor الأول — يُترك أو يُؤرشف حسب الحالة */
  firstProductId: string;
}

/** متجر معتمد بعملة تسويته، ومنتج makeVendor الأول مؤرشفاً إن طُلب — كي لا يزاحم ما تعدّه الحالة */
export async function makeShop(opts: { currency?: string; keepFirst?: boolean; data?: Record<string, unknown> } = {}): Promise<Shop> {
  const t = tag();
  const v = await makeVendor(t);
  const vendor = await prisma.vendor.update({
    where: { id: v.vendorId },
    data: { settlementCurrency: opts.currency ?? 'JOD', country: 'JO', ...opts.data },
  });
  const first = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  if (!opts.keepFirst) await prisma.product.update({ where: { id: first.id }, data: { status: 'archived' } });
  return { t, email: v.email, vendorId: v.vendorId, slug: vendor.slug, nameAr: vendor.nameAr, categoryId: first.vendorCategoryId!, firstProductId: first.id };
}

export interface ProductSpec {
  nameAr: string;
  nameEn?: string;
  descriptionAr?: string;
  price?: bigint;
  compareAt?: bigint;
  stock?: number;
  status?: 'active' | 'draft' | 'rejected';
  publishedAt?: Date;
  categoryId?: string | null;
  options?: [string, string][];
  slug?: string;
}

/** منتج بمتغيّر واحد، ومخزونه يطابق حركته (حارس audit_inventory_drift) */
export async function addProduct(shop: Shop, spec: ProductSpec): Promise<{ id: string; slug: string; variantId: string; nameAr: string }> {
  const status = spec.status ?? 'active';
  const product = await prisma.product.create({
    data: {
      vendorId: shop.vendorId,
      vendorCategoryId: spec.categoryId === undefined ? shop.categoryId : spec.categoryId,
      slug: spec.slug ?? `disc-${shop.t}-${Math.random().toString(36).slice(2, 9)}`,
      nameAr: spec.nameAr,
      nameEn: spec.nameEn ?? null,
      descriptionAr: spec.descriptionAr ?? null,
      status,
      publishedAt: status === 'draft' ? null : (spec.publishedAt ?? new Date()),
      hasVariants: (spec.options?.length ?? 0) > 0,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      vendorId: shop.vendorId,
      sku: `DISC-${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
      priceMinorUnits: spec.price ?? 10_000n,
      compareAtPriceMinorUnits: spec.compareAt ?? null,
      optionsKey: (spec.options ?? []).map(([a, v]) => `${a}:${v}`).join('|'),
      isActive: true,
      ...(spec.options?.length ? { optionValues: { create: spec.options.map(([attributeId, attributeValueId]) => ({ attributeId, attributeValueId })) } } : {}),
    },
  });
  const stock = spec.stock ?? 10;
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: stock, reserved: 0 } });
  if (stock > 0) await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: stock, reason: 'import' } });
  return { id: product.id, slug: product.slug, variantId: variant.id, nameAr: product.nameAr };
}

export async function vendorToken(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
}

/** حفظ المنتج من حساب بائعه بلا تغيير — الحفظ يزامن الفهرس، ثم ننتظر أن يجد البحث العدد المتوقَّع */
export async function indexProducts(shop: Shop, productIds: readonly string[], probe: { q: string; total: number }): Promise<void> {
  const token = await vendorToken(shop.email);
  for (const id of productIds) {
    const res = await fetch(`${API}/vendor/products/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  }
  await expect
    .poll(async () => ((await (await fetch(`${API}/storefront/products?q=${encodeURIComponent(probe.q)}`)).json()) as { total: number }).total, { timeout: 20_000 })
    .toBe(probe.total);
}

/** قيم اللون والمقاس من القاعدة بأسمائها */
export async function attrValue(code: 'color' | 'size', valueAr: string): Promise<{ attributeId: string; id: string }> {
  const v = await prisma.attributeValue.findFirstOrThrow({ where: { attribute: { code }, valueAr }, select: { id: true, attributeId: true } });
  return { attributeId: v.attributeId, id: v.id };
}

/** تُعلَّق متاجر الحالة بعدها — لا تبقى في دليل المتاجر ولا بحث صاحبة المشروع */
export async function retire(...shops: Shop[]): Promise<void> {
  if (shops.length === 0) return;
  await prisma.vendor.updateMany({ where: { id: { in: shops.map((s) => s.vendorId) } }, data: { status: 'suspended', suspendedAt: new Date() } });
}
