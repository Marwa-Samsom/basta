import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

/** مهلة التحويل الافتراضية بالساعات — ما بعدها يُلغى الطلب وتعود القطع للمخزون */
export const DEFAULT_TRANSFER_WINDOW_HOURS = 48;

export interface TransferDetails {
  /** اسم صاحب الحساب كما يظهر للمحوِّل في تطبيق بنكه */
  readonly beneficiary: string | null;
  readonly bank: string | null;
  readonly iban: string | null;
  /** الاسم المستعار على كليك */
  readonly cliqAlias: string | null;
  readonly windowHours: number;
  /** فيها ما يكفي ليحوّل المشتري: اسم المستفيد ووجهة واحدة على الأقل */
  readonly ready: boolean;
}

const KEYS = ['transfer_beneficiary', 'transfer_bank', 'transfer_iban', 'transfer_cliq_alias', 'transfer_window_hours'] as const;

/**
 * بيانات التحويل التي تُعرض للمشتري — من إعدادات المنصة (الإدارة ← الإعدادات)، لا من
 * متغيّرات الخادم: تغيير الحساب أو الاسم المستعار لا يحتاج نشراً جديداً.
 */
@Injectable()
export class TransferDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  async read(): Promise<TransferDetails> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [...KEYS] } } });
    const text = (key: (typeof KEYS)[number]): string | null => {
      const v = rows.find((r) => r.key === key)?.valueJson;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const hours = Number(rows.find((r) => r.key === 'transfer_window_hours')?.valueJson);
    const beneficiary = text('transfer_beneficiary');
    const iban = text('transfer_iban');
    const cliqAlias = text('transfer_cliq_alias');
    return {
      beneficiary,
      bank: text('transfer_bank'),
      iban,
      cliqAlias,
      windowHours: Number.isInteger(hours) && hours >= 1 ? hours : DEFAULT_TRANSFER_WINDOW_HOURS,
      ready: beneficiary !== null && (iban !== null || cliqAlias !== null),
    };
  }
}
