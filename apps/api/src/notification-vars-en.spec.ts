/**
 * كل نصّ ثابت تضعه الوحدات في متغيّر إشعار له ترجمة (4 نوفمبر 2026): من لغة حسابه الإنجليزية
 * تصله الحالة والسبب والقرار بالإنجليزية (notifications/domain/english-vars.ts). نصّ يُضاف بلا
 * ترجمة يُسقط هذا، كما يُسقط en-coverage رسالة خادم بلا ترجمة. هنا لا داخل وحدة: يقرأ خرائط
 * وحدات عدّة من واجهاتها العامة، وحدودها (ADR-002) لا تسمح لوحدة بداخل أخرى.
 */
import { describe, expect, it } from 'vitest';
import { toEnglish } from './common/i18n/translate';
import { RETURN_REASON_LABELS } from './common/return-lines';
import { DISPUTE_REASON_AR, DRIFT_LABELS } from './modules/admin/public';
import { OUTCOME_AR, OUTCOME_CUSTOMER_TRANSFER_AR, REASON_AR } from './modules/aftersales/public';
import { STATUS_LABELS } from './modules/orders/public/status-labels';
import { DOCUMENT_LABELS } from './modules/vendors/public';

describe('متغيّرات الإشعار بالإنجليزية', () => {
  it('كل نصّ ثابت يضعه الكود في متغيّر إشعار له ترجمة', () => {
    const fixed = [
      ...Object.values(STATUS_LABELS),
      ...Object.values(RETURN_REASON_LABELS),
      ...Object.values(REASON_AR),
      ...Object.values(DISPUTE_REASON_AR),
      ...Object.values(DRIFT_LABELS),
      ...Object.values(DOCUMENT_LABELS),
      ...Object.values(OUTCOME_AR.customer),
      ...Object.values(OUTCOME_AR.vendor),
      OUTCOME_CUSTOMER_TRANSFER_AR,
      'عميلنا', 'المشتري', 'المتجر', 'رقم التتبّع', 'مرجع التوصيل', 'لم يذكر المتجر سبباً', 'غير محدّد',
      'أرسل طلب انضمامه', 'أعاد إرسال طلبه بعد الرفض', 'استفسار عام',
    ];
    const missing = fixed.filter((ar) => toEnglish(ar) === ar);
    expect(missing).toEqual([]);
  });

});
