import { describe, expect, it } from 'vitest';
import { isInternalPath } from './application/content.service';

/**
 * رابط البانر مسار داخل الموقع. كل حالة «خارجية» هنا يفتحها المتصفح موقعاً آخر
 * لو وُضعت في href — والقاعدة نفسها في internalPath بالواجهة (next بعد الدخول).
 */
describe('رابط البانر — مسار داخلي فقط', () => {
  it.each(['/shops', '/s/متجر?category=x', '/search?q=a&page=2', '/p/x#reviews', '/'])('يقبل %s', (link) => {
    expect(isInternalPath(link)).toBe(true);
  });

  it.each([
    ['//evil.com', 'بلا بروتوكول'],
    ['/\\evil.com', 'الشرطة المائلة العكسية تُقرأ /'],
    ['/\t/evil.com', 'التاب يُحذف فتبقى //'],
    ['/\n/evil.com', 'سطر جديد يُحذف'],
    ['/\r/evil.com', 'رجوع السطر يُحذف'],
    ['/ /evil.com', 'مسافة'],
    ['https://evil.com', 'رابط كامل'],
    ['javascript:alert(1)', 'بروتوكول سكربت'],
    ['evil.com', 'بلا / في أوله'],
    ['/a\\..\\..\\/evil.com', '\\ في الوسط'],
  ])('يرفض %j (%s)', (link) => {
    expect(isInternalPath(link)).toBe(false);
  });
});
