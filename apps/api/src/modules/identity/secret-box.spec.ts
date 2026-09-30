import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateTotpSecret } from './domain/totp';
import { isLegacyPlain, openTotpSecret, sealTotpSecret } from './infrastructure/secret-box';

/** سرّ التحقق الثنائي لا يُقرأ من القاعدة: مشفّر، ومربوط بحسابه، ولا يُعبث به */
describe('صندوق أسرار التحقق الثنائي', () => {
  const key = randomBytes(32);
  const secret = generateTotpSecret();

  it('يُفكّ بالمفتاح والحساب نفسيهما، ولا يحمل السرّ ولا يتكرّر', () => {
    const a = sealTotpSecret(secret, 'user-1', key);
    const b = sealTotpSecret(secret, 'user-1', key);
    expect(a).toMatch(/^v1\./);
    expect(a).not.toContain(secret);
    expect(a).not.toBe(b);
    expect(isLegacyPlain(a)).toBe(false);
    expect(openTotpSecret(a, 'user-1', key)).toBe(secret);
  });

  it('لا يُفكّ في صفّ حساب آخر، ولا بمفتاح آخر، ولا بعد العبث به', () => {
    const sealed = sealTotpSecret(secret, 'user-1', key);
    expect(() => openTotpSecret(sealed, 'user-2', key)).toThrow();
    expect(() => openTotpSecret(sealed, 'user-1', randomBytes(32))).toThrow();
    const [v, iv, tag, ct] = sealed.split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => openTotpSecret([v, iv, tag, flipped.toString('base64url')].join('.'), 'user-1', key)).toThrow();
    expect(() => openTotpSecret('v2.x.y.z', 'user-1', key)).toThrow();
  });

  it('السرّ القديم المكتوب نصّاً يُقرأ كما هو — ليُشفَّر عند أول استعمال', () => {
    expect(isLegacyPlain(secret)).toBe(true);
    expect(openTotpSecret(secret, 'user-1', key)).toBe(secret);
  });
});
