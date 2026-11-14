/**
 * متغيّرات الإشعار بالإنجليزية (4 نوفمبر 2026): ما يكتبه الكود يصل مترجماً، وما كتبه إنسان يبقى.
 * وأن لكل نصّ ثابت تضعه الوحدات في متغيّر ترجمةً: src/notification-vars-en.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { format, money } from '../../../common/money/money';
import { englishCounts, englishMoney, englishVars, storeNameVars } from './english-vars';

/** Intl يفصل رمز العملة عن الرقم بمسافة ثابتة (NBSP) — تُقرأ مسافة عادية في المقارنة */
const NBSP = new RegExp(String.fromCodePoint(0xa0), 'g');
const plain = (v: string | null): string | null => (v === null ? null : v.replace(NBSP, ' '));

describe('متغيّرات الإشعار بالإنجليزية', () => {
  it('المبالغ بعملاتها: «125.500 د.أ.» ← «JOD 125.500»، وما ليس مبلغاً لا يُمسّ', () => {
    expect(plain(englishMoney(format(money(125_500n, 'JOD'), 'ar')))).toBe('JOD 125.500');
    expect(plain(englishMoney(format(money(15_050n, 'SAR'), 'ar')))).toBe('SAR 150.50');
    expect(plain(englishMoney(format(money(15_050n, 'USD'), 'ar')))).toBe('$150.50');
    expect(plain(englishMoney(format(money(123_456_789n, 'KWD'), 'ar')))).toBe('KWD 123,456.789');
    // عيّنات القوالب تكتبه بلا نقطته الأخيرة
    expect(plain(englishMoney('125.500 د.أ'))).toBe('JOD 125.500');
    expect(englishMoney('سارة')).toBeNull();
    expect(englishMoney('48')).toBeNull();
  });

  it('ما يكتبه الكود يُترجم، وما كتبه إنسان يبقى كما هو', () => {
    const out = englishVars({
      amount: format(money(125_500n, 'JOD'), 'ar'),
      name: 'عميلنا',
      status: 'تعذّر التوصيل',
      reason: 'لم يقبله البائع خلال 48 ساعة',
      outcome: 'حُسم لصالح المتجر',
      check: 'رصيد محفظة لا يطابق دفترها',
      kind: 'أرسل طلب انضمامه',
      sender: 'المشتري',
      tracking_label: 'رقم التتبّع',
      context: 'منتج: عطر أحمد الملكي',
      items: 'قميص (SKU-1): بقي 2، كوب (SKU-2): نفد، وغيرها في صفحة المخزون',
      pay_to: 'كليك: BASTA\nIBAN: JO71CBJO0000000000001234567890\nالبنك: بنك القاهرة عمان\nالمستفيد: شركة بسطة',
      deadline: '16 أكتوبر 2026 في 3:00 م',
      deadline_at: '2026-10-16T12:00:00.000Z',
      store_name: 'متجر الورد',
      preview: 'هل يوجد مقاس أكبر؟',
      order_number: 'BST-261016-A1B2C3',
      link: '/account/orders/BST-261016-A1B2C3',
    });
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, plain(v)]))).toMatchObject({
      amount: 'JOD 125.500',
      name: 'there',
      status: 'Delivery failed',
      reason: 'The seller did not accept it within 48 hours',
      outcome: 'resolved in the store’s favor',
      check: 'Wallet balance does not match its ledger',
      kind: 'submitted its application',
      sender: 'The buyer',
      tracking_label: 'Tracking number',
      context: 'Product: عطر أحمد الملكي',
      items: 'قميص (SKU-1): 2 left, كوب (SKU-2): out of stock, and more on the inventory page',
      pay_to: 'CliQ: BASTA\nIBAN: JO71CBJO0000000000001234567890\nBank: بنك القاهرة عمان\nBeneficiary: شركة بسطة',
      deadline: '16 October 2026 at 15:00',
      // كتبها إنسان
      store_name: 'متجر الورد',
      preview: 'هل يوجد مقاس أكبر؟',
      order_number: 'BST-261016-A1B2C3',
      link: '/account/orders/BST-261016-A1B2C3',
    });
    // المتجر باسمه الإنجليزي إن وصل معه — في أيّ متغيّر كُتب
    expect(englishVars(storeNameVars({ nameAr: 'متجر الورد', nameEn: 'Rose Store' })).store_name).toBe('Rose Store');
    expect(englishVars(storeNameVars({ nameAr: 'متجر الورد', nameEn: 'Rose Store' }, 'name')).name).toBe('Rose Store');
    // متجر قديم بلا اسم إنجليزي: بالعربي، ولا متغيّر فارغ
    expect(storeNameVars({ nameAr: 'متجر الورد', nameEn: null })).toEqual({ store_name: 'متجر الورد' });
    expect(englishVars(storeNameVars({ nameAr: 'متجر الورد', nameEn: '' })).store_name).toBe('متجر الورد');
    // الاسم المكتوب لا يُترجم ولو طابق كلمة في القاموس
    expect(englishVars({ name: 'منتجات' }).name).toBe('منتجات');
    // سبب الإلغاء الآلي بكل صيغ العدد العربية
    expect(englishVars({ reason: 'لم يقبله البائع خلال ساعة واحدة' }).reason).toBe('The seller did not accept it within 1 hour');
    expect(englishVars({ reason: 'لم يقبله البائع خلال ساعتين' }).reason).toBe('The seller did not accept it within 2 hours');
    expect(englishVars({ reason: 'لم يقبله البائع خلال 5 ساعات' }).reason).toBe('The seller did not accept it within 5 hours');
  });

  it('«1 hours» ← «1 hour» في القوالب الإنجليزية، والأعداد الأخرى كما هي', () => {
    expect(englishCounts('within 1 hours, 3 hours, 1 stores, 11 days')).toBe('within 1 hour, 3 hours, 1 store, 11 days');
  });
});
