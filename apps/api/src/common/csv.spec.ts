import { describe, expect, it } from 'vitest';
import { csvCell } from './csv';

describe('خانة CSV لا تُقرأ معادلة', () => {
  it('ما يبدأ بـ = + - @ أو تاب أو رجوع سطر يُسبق بـ \'', () => {
    for (const formula of ['=1+1', '=HYPERLINK("x")', '+SUM(A1)', '-1+2', '@cmd', '\t=1', '\r=1', '-A1']) {
      expect(csvCell(formula), JSON.stringify(formula)).toBe(`"'${formula.replace(/"/g, '""')}"`);
    }
  });

  it('الرقم الخالص يبقى رقماً، والنصّ العادي كما هو، والاقتباس مضاعف', () => {
    expect(csvCell('-2500')).toBe('"-2500"');
    expect(csvCell('12.5')).toBe('"12.5"');
    expect(csvCell(30000n)).toBe('"30000"');
    expect(csvCell('قميص "أزرق"')).toBe('"قميص ""أزرق"""');
    expect(csvCell(null)).toBe('""');
  });
});
