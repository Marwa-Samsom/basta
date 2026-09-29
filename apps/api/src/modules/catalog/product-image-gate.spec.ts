import { describe, expect, it } from 'vitest';
import { ProductImageGate, imageSignatureValid, signImageKey } from './infrastructure/product-image-gate';

const KEY = 'products/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
const url = (q = '') => `/uploads/${KEY}/thumb.webp${q}`;

/** قاعدة وهمية: ظهور المنتج ولقطات الطلبات كما يحدّدها الاختبار */
const gateWith = (visible: number, ordered: number) =>
  new ProductImageGate({ product: { count: async () => visible }, orderItem: { count: async () => ordered } } as never);

describe('بوابة صور المنتجات', () => {
  it('صورة في طلب تبقى لسجلّ المشتري ولو اختفى منتجها، وما سواها يُحجب', async () => {
    expect(await gateWith(0, 1).allows(url())).toBe(true);
    expect(await gateWith(1, 0).allows(url())).toBe(true);
    expect(await gateWith(0, 0).allows(url())).toBe(false);
  });

  it('ما ليس صورة منتج لا شأن لها به، والمسار المشوّه يُحجب', async () => {
    expect(await gateWith(0, 0).allows('/uploads/banners/33333333-3333-4333-8333-333333333333/full.webp')).toBeNull();
    expect(await gateWith(1, 1).allows('/uploads/products/../../secrets/full.webp')).toBe(false);
  });

  it('التوقيع لمفتاحه ولمدّته: يومان على الأقل، ولا يصلح لصورة أخرى ولا بعد انقضائه', () => {
    const now = Date.UTC(2026, 8, 29, 23, 59);
    const s = signImageKey(KEY, now);
    expect(imageSignatureValid(KEY, s, now)).toBe(true);
    expect(imageSignatureValid(KEY, s, now + 2 * 86_400_000)).toBe(true);
    expect(imageSignatureValid(KEY, s, now + 4 * 86_400_000)).toBe(false);
    expect(imageSignatureValid(KEY.replace('2222', '3333'), s, now)).toBe(false);
    // ثابت طوال اليوم — الرابط يبقى في ذاكرة المتصفّح
    expect(signImageKey(KEY, Date.UTC(2026, 8, 29, 0, 1))).toBe(s);
  });
});
