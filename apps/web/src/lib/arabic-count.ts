import { num } from '@/lib/catalog';

/**
 * العدد ومعدوده بالعربية — نظير apps/api/src/common/arabic-count.ts للواجهة. كانت عدّادات اللوحتين
 * تلصق المفرد بأي رقم: «4 منتج»، «15 طلب ينتظر»، و«2 طلبات تنتظر قبولك» (الموجة 4، 2 نوفمبر 2026).
 * القاعدة: الواحد والاثنان بلفظهما، ومن 3 إلى 10 جمعٌ، ومن 11 إلى 99 مفردٌ منصوب، والمئة فما فوق
 * والصفر مفردٌ مجرور. `#` في الصيغة مكان الرقم، بأرقام لاتينية (DESIGN-SYSTEM §7).
 */
export interface Counted {
  one: string;
  two: string;
  plural: string;
  accusative: string;
  genitive: string;
}

export function counted(n: number, forms: Counted): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const tail = n % 100;
  const form = tail >= 3 && tail <= 10 ? forms.plural : tail >= 11 && tail <= 99 ? forms.accusative : forms.genitive;
  return form.replace('#', num(n));
}

/** «طلب واحد ينتظر قبولك»، «طلبان ينتظران قبولك»، «4 طلبات تنتظر قبولك»، «11 طلباً ينتظر قبولك» */
export const WAITING_ORDERS: Counted = {
  one: 'طلب واحد ينتظر قبولك',
  two: 'طلبان ينتظران قبولك',
  plural: '# طلبات تنتظر قبولك',
  accusative: '# طلباً ينتظر قبولك',
  genitive: '# طلب ينتظر قبولك',
};

/** «منتج واحد»، «منتجان»، «4 منتجات»، «11 منتجاً»، «100 منتج» */
export const PRODUCTS: Counted = { one: 'منتج واحد', two: 'منتجان', plural: '# منتجات', accusative: '# منتجاً', genitive: '# منتج' };

/** «متجر واحد»، «متجران»، «4 متاجر»، «11 متجراً» */
export const STORES: Counted = { one: 'متجر واحد', two: 'متجران', plural: '# متاجر', accusative: '# متجراً', genitive: '# متجر' };

/** «طلب واحد»، «طلبان»، «4 طلبات»، «11 طلباً» */
export const ORDERS: Counted = { one: 'طلب واحد', two: 'طلبان', plural: '# طلبات', accusative: '# طلباً', genitive: '# طلب' };

/** «عميل واحد»، «عميلان»، «4 عملاء»، «11 عميلاً» */
export const CUSTOMERS: Counted = { one: 'عميل واحد', two: 'عميلان', plural: '# عملاء', accusative: '# عميلاً', genitive: '# عميل' };

/** «نزاع واحد»، «نزاعان»، «4 نزاعات»، «11 نزاعاً» */
export const DISPUTES: Counted = { one: 'نزاع واحد', two: 'نزاعان', plural: '# نزاعات', accusative: '# نزاعاً', genitive: '# نزاع' };

/** «متغيّر واحد»، «متغيّران»، «4 متغيّرات»، «11 متغيّراً» */
export const VARIANTS: Counted = { one: 'متغيّر واحد', two: 'متغيّران', plural: '# متغيّرات', accusative: '# متغيّراً', genitive: '# متغيّر' };
