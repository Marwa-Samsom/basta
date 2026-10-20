import { describe, expect, it } from 'vitest';
import {
  add,
  applyFxSpread,
  commissionOf,
  compare,
  convert,
  format,
  minorUnitDigits,
  money,
  MoneyError,
  multiply,
  parse,
  proRata,
  shareBetween,
  subtract,
  sum,
  toDecimalString,
  zero,
} from './money';

describe('فخّ الخانات العشرية — ADR-013', () => {
  it('يعرف أن الدينار ثلاث خانات والدولار اثنتان', () => {
    expect(minorUnitDigits('JOD')).toBe(3);
    expect(minorUnitDigits('KWD')).toBe(3);
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('SAR')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('الرقم 50000 يعني 500.00 دولاراً و 50.000 ديناراً', () => {
    expect(toDecimalString(money(50_000n, 'USD'))).toBe('500.00');
    expect(toDecimalString(money(50_000n, 'JOD'))).toBe('50.000');
  });

  it('«12.500» بالدينار تعني 12500 فلساً لا 1250', () => {
    expect(parse('12.500', 'JOD').minorUnits).toBe(12_500n);
    expect(parse('12.50', 'USD').minorUnits).toBe(1_250n);
  });

  it('يرفض خانات عشرية أكثر مما تقبله العملة', () => {
    expect(() => parse('12.500', 'USD')).toThrow(MoneyError);
    expect(() => parse('12.5001', 'JOD')).toThrow(MoneyError);
  });

  it('يقبل الفاصلة العربية والفواصل الألفية', () => {
    expect(parse('1٫250', 'JOD').minorUnits).toBe(1_250n);
    expect(parse('1,234.56', 'USD').minorUnits).toBe(123_456n);
  });

  it('يرفض عملة غير مسجّلة', () => {
    expect(() => money(100n, 'XYZ')).toThrow(MoneyError);
  });
});

describe('الحارس ضد خلط العملات — INV-12', () => {
  it('يرفض جمع دينار على دولار', () => {
    expect(() => add(money(1000n, 'USD'), money(1000n, 'JOD'))).toThrow(/عملتين مختلفتين/);
  });

  it('يرفض الطرح والمقارنة بين عملتين', () => {
    expect(() => subtract(money(1000n, 'SAR'), money(500n, 'AED'))).toThrow(MoneyError);
    expect(() => compare(money(1000n, 'SAR'), money(500n, 'AED'))).toThrow(MoneyError);
  });

  it('يجمع بلا اعتراض حين تتّحد العملة', () => {
    const total = sum([money(1000n, 'SAR'), money(2500n, 'SAR'), money(499n, 'SAR')], 'SAR');
    expect(total.minorUnits).toBe(3_999n);
  });

  it('مجموع قائمة فارغة صفر بالعملة المطلوبة', () => {
    expect(sum([], 'USD')).toEqual(zero('USD'));
  });
});

describe('العمولة — ADR-001', () => {
  it('تُحتسب على السطر بنسبة bps', () => {
    // 249.00 ريال بعمولة 10%
    expect(commissionOf(money(24_900n, 'SAR'), 1000).minorUnits).toBe(2_490n);
  });

  it('تقرّب لأسفل دائماً لصالح البائع', () => {
    // 33 هللة × 10% = 3.3 → 3
    expect(commissionOf(money(33n, 'SAR'), 1000).minorUnits).toBe(3n);
    // 99 × 12.5% = 12.375 → 12
    expect(commissionOf(money(99n, 'SAR'), 1250).minorUnits).toBe(12n);
  });

  it('مجموع عمولات الأسطر لا يتجاوز أبداً عمولة المجموع', () => {
    // السبب الحقيقي لقاعدة التقريب لأسفل: منع فرق القرش بين المستويين
    const lines = [money(333n, 'SAR'), money(333n, 'SAR'), money(334n, 'SAR')];
    const perLine = lines.reduce((acc, l) => acc + commissionOf(l, 1000).minorUnits, 0n);
    const onTotal = commissionOf(sum(lines, 'SAR'), 1000).minorUnits;
    expect(perLine).toBeLessThanOrEqual(onTotal);
  });

  it('يرفض نسبة خارج المدى', () => {
    expect(() => commissionOf(money(100n, 'USD'), -1)).toThrow(MoneyError);
    expect(() => commissionOf(money(100n, 'USD'), 10_001)).toThrow(MoneyError);
  });

  it('عمولة صفرية على مبلغ صفري', () => {
    expect(commissionOf(zero('USD'), 1000).minorUnits).toBe(0n);
  });
});

describe('التحويل بسعر ملقوط — ADR-013', () => {
  it('يعاير فرق الخانات بين الدولار والدينار', () => {
    // 100.00 دولار × 0.709 = 70.900 دينار → 70900 فلساً لا 7090
    const result = convert(money(10_000n, 'USD'), 'JOD', 0.709);
    expect(result.minorUnits).toBe(70_900n);
    expect(toDecimalString(result)).toBe('70.900');
  });

  it('يحوّل بين عملتين بالخانات نفسها', () => {
    const result = convert(money(10_000n, 'USD'), 'SAR', 3.75);
    expect(result.minorUnits).toBe(37_500n);
  });

  it('يعيد المبلغ كما هو حين تتّحد العملة', () => {
    const original = money(12_345n, 'USD');
    expect(convert(original, 'USD', 999)).toBe(original);
  });

  it('يرفض سعر صرف غير صالح', () => {
    expect(() => convert(money(100n, 'USD'), 'JOD', 0)).toThrow(MoneyError);
    expect(() => convert(money(100n, 'USD'), 'JOD', -1)).toThrow(MoneyError);
  });

  it('هامش الصرف 2% يُطبَّق على المبلغ', () => {
    expect(applyFxSpread(money(10_000n, 'USD'), 200).minorUnits).toBe(10_200n);
  });
});

describe('الاسترداد النسبي', () => {
  it('استرداد نصف الطلب يعكس نصف العمولة', () => {
    const commission = money(2_490n, 'SAR');
    expect(proRata(commission, 1, 2).minorUnits).toBe(1_245n);
  });

  it('استرداد صنف من ثلاثة يعكس ثلث العمولة، مقرّباً لأسفل', () => {
    expect(proRata(money(100n, 'SAR'), 1, 3).minorUnits).toBe(33n);
  });

  it('يرفض مقاماً صفرياً', () => {
    expect(() => proRata(money(100n, 'USD'), 1, 0)).toThrow(MoneyError);
  });

  it('النصيب التراكمي: كل قطعة لأسفل والأخيرة تكمل — المجموع المبلغ بالضبط بأي تقسيم', () => {
    expect([0, 1, 2].map((k) => shareBetween(10_000n, k, k + 1, 3))).toEqual([3_333n, 3_333n, 3_334n]);
    expect(shareBetween(10_000n, 0, 2, 3) + shareBetween(10_000n, 2, 3, 3)).toBe(10_000n);
    expect(shareBetween(6_617n, 0, 1, 2) + shareBetween(6_617n, 1, 2, 2)).toBe(6_617n);
    for (const qty of [1, 2, 3, 7, 13]) {
      for (const amount of [1n, 99n, 10_000n, 123_457n]) {
        let sum = 0n;
        for (let k = 0; k < qty; k++) sum += shareBetween(amount, k, k + 1, qty);
        expect(sum).toBe(amount);
      }
    }
  });

  it('لا نصيب خارج السطر', () => {
    expect(() => shareBetween(100n, 2, 4, 3)).toThrow(MoneyError);
    expect(() => shareBetween(100n, 2, 1, 3)).toThrow(MoneyError);
    expect(() => shareBetween(100n, 0, 1, 0)).toThrow(MoneyError);
  });
});

describe('سلامة الأنواع', () => {
  it('يرفض مبلغاً كسرياً', () => {
    expect(() => money(12.5, 'USD')).toThrow(MoneyError);
  });

  it('الضرب في كمية صحيحة فقط', () => {
    expect(multiply(money(3_800n, 'SAR'), 2).minorUnits).toBe(7_600n);
    expect(() => multiply(money(100n, 'USD'), 1.5)).toThrow(MoneyError);
    expect(() => multiply(money(100n, 'USD'), -1)).toThrow(MoneyError);
  });

  it('يصمد أمام مبالغ تتجاوز مدى العدد الآمن في جافاسكربت', () => {
    // 90 مليار دولار — رقم يفقد الدقة كـ Number ويبقى مضبوطاً كـ BigInt
    const huge = money(9_000_000_000_000n, 'USD');
    expect(add(huge, money(1n, 'USD')).minorUnits).toBe(9_000_000_000_001n);
  });
});

describe('العرض', () => {
  it('ينسّق الدينار بثلاث خانات والدولار باثنتين', () => {
    expect(format(money(70_900n, 'JOD'), 'ar-JO')).toContain('70.900');
    expect(format(money(50_000n, 'USD'), 'ar')).toContain('500.00');
  });

  it('يستعمل الأرقام اللاتينية افتراضياً ولو كانت اللغة عربية', () => {
    // الأرقام الهندية تكسر محاذاة tabular-nums في جداول اللوحات
    const out = format(money(70_900n, 'JOD'), 'ar-JO');
    expect(out).toMatch(/[0-9]/);
    expect(out).not.toMatch(/[٠-٩]/);
  });

  it('يعطي الأرقام الهندية حين تُطلب صراحةً', () => {
    expect(format(money(70_900n, 'JOD'), 'ar-JO', 'arab')).toMatch(/[٠-٩]/);
  });

  it('يعرض السالب بإشارته', () => {
    expect(toDecimalString(money(-5_000n, 'SAR'))).toBe('-50.00');
  });
});
