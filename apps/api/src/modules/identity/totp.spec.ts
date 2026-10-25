import { NobleCryptoPlugin, ScureBase32Plugin, generateSync } from 'otplib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTotpSecret, verifyTotp, verifyTotpStep } from './domain/totp';

/**
 * رمز كُتب في آخر ثوانٍ من نافذته ووصل بعد تبدّلها (25 أكتوبر 2026): كان يُرفض «رمز غير صحيح»،
 * وأسقط اختبار التحقق بخطوتين في CI مرة. الخطوة السابقة مقبولة، واللاحقة والأقدم لا.
 */
describe('رمز التحقق عند حدّ النافذة', () => {
  const secret = generateTotpSecret();
  const at = (epoch: number) => generateSync({ strategy: 'totp', secret, epoch, crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
  const step = 59_000_000; // خطوة ما من عام 2026؛ تبدأ عند step * 30 ثانية
  const now = (seconds: number) => vi.setSystemTime(seconds * 1000);

  afterEach(() => vi.useRealTimers());

  it('كُتب في آخر ثانية من نافذته ووصل بعد ثانيتين: مقبول، بخطوته هو', () => {
    vi.useFakeTimers();
    const typed = at(step * 30 + 29);
    now(step * 30 + 31);
    expect(verifyTotp(typed, secret)).toBe(true);
    expect(verifyTotpStep(typed, secret)).toBe(step);
  });

  it('مستعمَل من قبل: يبقى مرفوضاً ولو كان من الخطوة السابقة', () => {
    vi.useFakeTimers();
    const typed = at(step * 30 + 29);
    now(step * 30 + 31);
    expect(verifyTotpStep(typed, secret, step)).toBeNull();
  });

  it('أقدم من خطوة، أو من خطوة لم تأتِ بعد: مرفوض', () => {
    vi.useFakeTimers();
    const stale = at(step * 30 - 1);
    const future = at(step * 30 + 61);
    now(step * 30 + 31);
    expect(verifyTotp(stale, secret)).toBe(false);
    expect(verifyTotp(future, secret)).toBe(false);
  });
});
