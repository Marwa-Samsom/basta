import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';

import type { VendorLifecycle } from '../domain/onboarding';

/** الاسم القديم محفوظ لمن يستورده؛ المصدر الآن دورة الحياة في المجال. */
export type VendorStatus = VendorLifecycle;

export interface VendorSummary {
  readonly id: string;
  readonly nameAr: string;
  readonly status: VendorStatus;
  /** عملة التسعير والتحصيل معاً — ADR-013. كل سعر يُدخله البائع يُفسَّر بها */
  readonly settlementCurrency: string;
}

/**
 * القراءة الوحيدة التي تحتاجها الوحدات الأخرى من البائعين قبل المرحلة 06.
 * وحدة البائعين الكاملة (التسجيل والتوثيق والمراجعة) تُبنى فوق هذا لا بجانبه.
 */
@Injectable()
export class VendorDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async get(vendorId: string): Promise<VendorSummary> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, nameAr: true, status: true, settlementCurrency: true },
    });
    if (!vendor) throw new NotFoundError('المتجر غير موجود.', { vendorId });
    return vendor;
  }
}
