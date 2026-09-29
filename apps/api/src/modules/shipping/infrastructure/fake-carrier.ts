import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { CarrierProvider, Waybill } from '../domain/carrier';

/**
 * شركة شحن وهمية محلية: بوليصة برقم تتبّع حقيقي الشكل، ومسار يتقدّم بمهمة
 * التتبّع. لا شبكة ولا حساب — المشروع محلي.
 */
@Injectable()
export class FakeCarrier implements CarrierProvider {
  readonly code = 'basta-express';
  readonly nameAr = 'بسطة إكسبرس (تجريبي)';

  constructor() {
    // خط الدفاع الثاني بعد loadEnv (SHIPPING_CARRIER): أي إقلاع في الإنتاج — ولو من
    // سكربت أو عامل لا يمرّ بـ main.ts — يسقط هنا قبل أن تُعلَّم شحنة مستلمة لم تصل
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('شركة الشحن الوهمية ممنوعة في الإنتاج — تعلّم كل شحنة مستلمة فتحرّر مال البائع. صِل شركة حقيقية.');
    }
  }

  async createWaybill(input: { subOrderNumber: string; recipient: string; city: string }): Promise<Waybill> {
    const trackingNumber = `BX${Date.now().toString().slice(-6)}${randomInt(1000, 9999)}`;
    return {
      carrierCode: this.code,
      trackingNumber,
      labelText: [
        this.nameAr,
        `رقم التتبّع: ${trackingNumber}`,
        `الطلب: ${input.subOrderNumber}`,
        `المستلم: ${input.recipient}`,
        `المدينة: ${input.city}`,
      ].join('\n'),
    };
  }
}
