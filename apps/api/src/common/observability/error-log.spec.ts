/**
 * إثبات «لا يمرّ خطأ صامتاً» — بند بوابة المرحلة 03 في صيغته المحلية.
 */
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// المسار يُضبط قبل استيراد الوحدة: القيمة تُقرأ مرة واحدة عند التحميل
process.env['ERROR_LOG_PATH'] = 'logs/errors.test.jsonl';

import { writeErrorLog, errorLogPath } from './error-log';

const readLines = () =>
  existsSync(errorLogPath())
    ? readFileSync(errorLogPath(), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

beforeAll(() => rmSync(errorLogPath(), { force: true }));
afterAll(() => rmSync(errorLogPath(), { force: true }));

describe('سجل الأخطاء الدائم', () => {
  it('يكتب سطراً قابلاً للاستعلام بمعرّف الطلب', () => {
    writeErrorLog({
      timestamp: new Date().toISOString(),
      requestId: 'req-42',
      level: 'error',
      message: 'فشل مقصود',
      method: 'GET',
      url: '/api/v1/health/boom',
    });

    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].requestId).toBe('req-42');
    expect(lines[0].url).toBe('/api/v1/health/boom');
  });

  it('يراكم الأسطر ولا يستبدلها — السجل تاريخ لا لقطة', () => {
    writeErrorLog({
      timestamp: new Date().toISOString(),
      requestId: 'req-43',
      level: 'fatal',
      message: 'ثانٍ',
    });
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.requestId)).toEqual(['req-42', 'req-43']);
  });

  it('يحذف الأسرار قبل الكتابة — السجل ليس مكاناً لكلمة مرور', () => {
    writeErrorLog({
      timestamp: new Date().toISOString(),
      requestId: 'req-44',
      level: 'error',
      message: 'فشل في {"password":"سرّي-جداً","iban":"JO94CBJO0010","email":"a@b.com"}',
    });

    const raw = readFileSync(errorLogPath(), 'utf8');
    expect(raw).not.toContain('سرّي-جداً');
    expect(raw).not.toContain('JO94CBJO0010');
    expect(raw).toContain('[محذوف]');
    // البريد ليس سرّاً وهو ما يربط البلاغ بصاحبه — يبقى
    expect(raw).toContain('a@b.com');
  });
});
