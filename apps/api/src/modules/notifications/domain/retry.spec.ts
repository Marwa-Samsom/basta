import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, nextAttemptAt } from './retry';

/**
 * يحاكي الصندوق الصادر: محاولة فور الحدث، وبعد كل فشل ينتظر موعد الجدول. البريد معطّل
 * أول `downForSeconds` ثانية ثم يعود. يعيد متى وصل الإشعار وبكم محاولة، أو أنه خُتم «فشل».
 */
function outage(downForSeconds: number): { delivered: boolean; atSeconds: number; attempts: number } {
  let t = 0;
  for (let attempts = 1; ; attempts++) {
    if (t >= downForSeconds) return { delivered: true, atSeconds: t, attempts };
    const next = nextAttemptAt(attempts, new Date(t * 1000));
    if (!next) return { delivered: false, atSeconds: t, attempts };
    t = next.getTime() / 1000;
  }
}

/**
 * SYS-031 (26 أكتوبر 2026): البريد معطّل دقيقة فخُتم رمز الاستعادة «فشل» بعد 23 ثانية وخمس
 * محاولات، ولم يُرسل حين عاد الخادم. الإعادة الآن بمهلة تطول على قرابة ساعتين.
 */
describe('إعادة إرسال الإشعار بمهلة تطول', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const after = (attempts: number) => (nextAttemptAt(attempts, now)!.getTime() - now.getTime()) / 1000;

  it('الانتظار يطول مع كل فشل: 10 ث، 30 ث، دقيقة، 5، 15، 30 دقيقة، ساعة', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(after)).toEqual([10, 30, 60, 300, 900, 1800, 3600]);
  });

  it('المحاولة الثامنة هي الأخيرة: لا موعد بعدها', () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(nextAttemptAt(MAX_ATTEMPTS, now)).toBeNull();
    expect(nextAttemptAt(0, now)).toBeNull();
  });

  it('البريد معطّل دقيقة: يصل بالمحاولة الرابعة بعد 100 ثانية — كان يُختم «فشل» بعد 25', () => {
    expect(outage(60)).toEqual({ delivered: true, atSeconds: 100, attempts: 4 });
  });

  it('البريد سليم: يصل بالمحاولة الأولى فوراً', () => {
    expect(outage(0)).toEqual({ delivered: true, atSeconds: 0, attempts: 1 });
  });

  it('معطّل ساعة: يصل بالمحاولة الأخيرة؛ معطّل ثلاث ساعات: يُختم «فشل» بعد قرابة ساعتين', () => {
    expect(outage(3600)).toEqual({ delivered: true, atSeconds: 6700, attempts: 8 });
    expect(outage(3 * 3600)).toEqual({ delivered: false, atSeconds: 6700, attempts: 8 });
  });
});
