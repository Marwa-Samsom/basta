import { BadRequestException, HttpException, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** ما يصل المستخدم من المترجم: الحالة والجسم */
function reply(exception: unknown): { status: number; body: unknown } {
  const out = { status: 0, body: undefined as unknown };
  const res = {
    status: (c: number) => {
      out.status = c;
      return { header: () => ({ send: (b: unknown) => (out.body = b) }) };
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'POST', url: '/api/v1/auth/login', id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}

describe('المترجم: النصّ الخام', () => {
  it('خطأ Fastify ملفوفاً (HttpException الأصل): رمز ورسالة عربية بدل نصّه الإنجليزي', () => {
    const r = reply(new HttpException("Body is not valid JSON but content-type is set to 'application/json'", 400));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: 'INVALID_INPUT', message: expect.stringMatching(/^تعذّرت قراءة الطلب/) });
  });

  it('حدّ المحاولات (ThrottlerException بنصّ خام): رسالته العربية تصل كما هي', () => {
    // كانت تصير «تعذّرت قراءة الطلب» في صفحة الدخول بدل «انتظر 15 دقيقة»
    const message = 'محاولات كثيرة من هذا الجهاز. انتظر 15 دقيقة ثم حاول من جديد.';
    const r = reply(new ThrottlerException(message));
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ message });
  });

  it('استثناء Nest بجسم كائن يمرّ كما هو', () => {
    const r = reply(new BadRequestException({ code: 'INVALID_INPUT', message: 'قيمة غير صالحة.' }));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: 'INVALID_INPUT', message: 'قيمة غير صالحة.' });
  });
});
