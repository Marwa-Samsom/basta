import { describe, expect, it } from 'vitest';
import { groupSessions, maskEmail, resendWaitSeconds, type TokenRow } from './domain/account';

const now = new Date('2026-09-26T12:00:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000);
const row = (familyId: string, createdMin: number, extra: Partial<TokenRow> = {}): TokenRow => ({
  familyId, userAgent: `ua-${familyId}`, ip: '10.0.0.1', createdAt: at(createdMin), expiresAt: at(60 * 24), revokedAt: null, ...extra,
});

describe('قواعد الحساب', () => {
  it('البريد مقنَّع يُبقي النطاق وحرفين', () => {
    expect(maskEmail('noura@example.com')).toBe('no•••@example.com');
    expect(maskEmail('a@x.io')).toBe('a•••@x.io');
    expect(maskEmail('broken')).toBe('•••');
  });

  it('مهلة إعادة الإرسال دقيقة من آخر رمز', () => {
    expect(resendWaitSeconds(null, now)).toBe(0);
    expect(resendWaitSeconds(at(-0.5), now)).toBe(30);
    expect(resendWaitSeconds(at(-2), now)).toBe(0);
  });

  it('الجلسة عائلة: المُبطَل والمنتهي لا يظهران، والحالية أولاً، وبداية الدخول أقدم صف', () => {
    const rows = [
      row('a', -10),
      row('b', -5),
      row('c', -3, { revokedAt: at(-1) }),
      row('d', -2, { expiresAt: at(-1) }),
    ];
    const out = groupSessions(rows, new Map([['a', at(-600)]]), 'a', now);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out[0]!.current).toBe(true);
    expect(out[0]!.signedInAt).toEqual(at(-600));
    expect(out[1]!.signedInAt).toEqual(at(-5));
  });
});
