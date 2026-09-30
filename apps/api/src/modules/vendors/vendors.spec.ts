import { describe, expect, it } from 'vitest';
import {
  assertDocumentFile,
  assertSlug,
  assertTransition,
  assertCurrencyChangeable,
  canSell,
  defaultCurrencyFor,
  isValidIban,
  normalizeIban,
  sniffDocumentMime,
  submissionBlockers,
  suggestSlug,
  vendorSlug,
  type OnboardingSnapshot,
} from './domain/onboarding';

const pdf = (): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const jpeg = (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

const snapshot = (over: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot => ({
  nameAr: 'دار القطن',
  slug: 'dar-alqutn',
  country: 'JO',
  documents: [
    { type: 'commercial_register', status: 'pending', rejectReason: null },
    { type: 'national_id', status: 'accepted', rejectReason: null },
    { type: 'tax_card', status: 'pending', rejectReason: null },
    { type: 'bank_proof', status: 'pending', rejectReason: null },
  ],
  bank: { iban: 'JO94CBJO0010000000000131000302', holderName: 'مروة سمسوم' },
  ...over,
});

describe('رابط المتجر', () => {
  it('يشتقّ من الاسم الإنجليزي ويقبل العربي حرفياً', () => {
    expect(vendorSlug('Dar AlQutn')).toBe('dar-alqutn');
    expect(vendorSlug('دار القطن')).toBe('dar-alqtn');
  });

  it('يسقط التشكيل ويقصّ الشرطات الزائدة', () => {
    expect(vendorSlug('  متجرُ   الأناقة  ')).not.toMatch(/(^-|-$|--)/);
  });

  it('يرفض المحجوز وغير الصالح', () => {
    expect(() => assertSlug('admin')).toThrow(/محجوز/);
    expect(() => assertSlug('a')).toThrow();
    expect(() => assertSlug('Dar')).toThrow();
    expect(() => assertSlug('dar-alqutn')).not.toThrow();
  });

  it('يقترح بديلاً متسلسلاً عند التصادم', () => {
    expect(suggestSlug('dar', new Set(['dar']))).toBe('dar-2');
    expect(suggestSlug('dar', new Set(['dar', 'dar-2']))).toBe('dar-3');
    expect(suggestSlug('dar', new Set())).toBe('dar');
  });
});

describe('الآيبان', () => {
  it('يقبل رقماً صحيحاً ويرفض خانة مقلوبة', () => {
    expect(isValidIban('JO94CBJO0010000000000131000302')).toBe(true);
    expect(isValidIban('JO94CBJO0010000000000131000320')).toBe(false);
    expect(isValidIban('SA0380000000608010167519')).toBe(true);
  });

  it('يتجاهل الفراغات والحالة', () => {
    expect(isValidIban('JO94CBJO0010000000000131000302'.toLowerCase().replace(/(.{4})/g, '$1 '))).toBe(true);
    expect(normalizeIban('jo94 cbjo-0010')).toBe('JO94CBJO0010');
  });

  it('يرفض ما ليس آيباناً أصلاً', () => {
    expect(isValidIban('12345')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });
});

describe('الوثائق', () => {
  it('يعرف النوع من المحتوى لا من الامتداد', () => {
    expect(sniffDocumentMime(pdf())).toBe('application/pdf');
    expect(sniffDocumentMime(jpeg())).toBe('image/jpeg');
    expect(sniffDocumentMime(Buffer.from('<?php system($_GET[0]); ?>  '))).toBeNull();
  });

  it('يرفض الملف الفارغ وغير المدعوم ويقبل المدعوم', () => {
    expect(() => assertDocumentFile(Buffer.alloc(0))).toThrow(/فارغ/);
    expect(() => assertDocumentFile(Buffer.from('نص عادي طويل بما يكفي للفحص'))).toThrow(/PDF/);
    expect(assertDocumentFile(pdf())).toBe('application/pdf');
  });
});

describe('موانع الإرسال', () => {
  it('لا مانع حين تكتمل الوثائق والحساب', () => {
    expect(submissionBlockers(snapshot())).toHaveLength(0);
  });

  it('تُعدّ الموانع مجتمعة لا واحداً واحداً', () => {
    const blockers = submissionBlockers(snapshot({ documents: [], bank: null, nameAr: ' ' }));
    expect(blockers).toHaveLength(6); // الاسم + أربع وثائق + الحساب
    expect(blockers.map((b) => b.code)).toContain('document_missing:tax_card');
    expect(blockers.map((b) => b.code)).toContain('bank_missing');
  });

  it('كل مانع يشير إلى حقله فتربطه الشاشة بالبطاقة', () => {
    const blockers = submissionBlockers(snapshot({ documents: [], bank: null }));
    expect(blockers.every((b) => b.field.length > 0)).toBe(true);
    expect(blockers.find((b) => b.code.startsWith('document_missing'))?.field).toMatch(/^documents\./);
  });

  it('الوثيقة المرفوضة مانع يحمل سبب المراجع', () => {
    const blockers = submissionBlockers(
      snapshot({
        documents: [
          { type: 'commercial_register', status: 'rejected', rejectReason: 'الصورة غير واضحة' },
          { type: 'national_id', status: 'accepted', rejectReason: null },
          { type: 'tax_card', status: 'accepted', rejectReason: null },
          { type: 'bank_proof', status: 'accepted', rejectReason: null },
        ],
      }),
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.message).toContain('الصورة غير واضحة');
  });

  it('آيبان بخانة مقلوبة مانع مستقل عن غيابه', () => {
    const wrong = submissionBlockers(
      snapshot({ bank: { iban: 'JO94CBJO0010000000000131000320', holderName: 'مروة' } }),
    );
    expect(wrong.map((b) => b.code)).toEqual(['bank_iban_invalid']);
  });
});

describe('دورة حياة المتجر', () => {
  it('البيع في حالة واحدة فقط', () => {
    expect(canSell('approved')).toBe(true);
    for (const s of ['pending', 'in_review', 'rejected', 'suspended', 'banned'] as const) {
      expect(canSell(s)).toBe(false);
    }
  });

  it('المرفوض يعود للمراجعة، والمعتمد لا يعود مسوّدة', () => {
    expect(() => assertTransition('rejected', 'in_review')).not.toThrow();
    expect(() => assertTransition('approved', 'in_review')).toThrow();
    expect(() => assertTransition('pending', 'approved')).toThrow();
    expect(() => assertTransition('in_review', 'approved')).not.toThrow();
  });

  it('المحظور نهاية الطريق', () => {
    expect(() => assertTransition('banned', 'approved')).toThrow();
    expect(() => assertTransition('approved', 'banned')).not.toThrow();
  });
});

describe('عملة التسوية', () => {
  it('تُقترح من البلد ولا تسقط أمام بلد غير معروف', () => {
    expect(defaultCurrencyFor('JO')).toBe('JOD');
    expect(defaultCurrencyFor('sa')).toBe('SAR');
    expect(defaultCurrencyFor('FR')).toBe('USD');
  });

  it('تتغيّر في التأهيل وحده وبلا شيء مسعَّر، وتُمنع بعد التثبيت — ADR-013', () => {
    const open = { lockedAt: null, status: 'pending', priced: false } as const;
    expect(() => assertCurrencyChangeable(open)).not.toThrow();
    expect(() => assertCurrencyChangeable({ ...open, status: 'rejected' })).not.toThrow();
    expect(() => assertCurrencyChangeable({ ...open, lockedAt: new Date() })).toThrow(/مثبَّتة/);
    // غير مثبَّتة لكن المتجر تجاوز التأهيل — متاجر ما قبل التثبيت التلقائي
    for (const status of ['in_review', 'approved', 'suspended', 'banned'] as const) {
      expect(() => assertCurrencyChangeable({ ...open, status })).toThrow(/قبل إرسال الطلب/);
    }
    expect(() => assertCurrencyChangeable({ ...open, priced: true })).toThrow(/مكتوبة بالعملة الحالية/);
  });
});
