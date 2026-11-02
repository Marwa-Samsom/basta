import { Injectable } from '@nestjs/common';
import { minorUnitDigits } from '../../../common/money/money';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { convertMinor, fxFactor, type FxInput } from '../domain/pricing';

/** إن غاب إعداد الإدارة أو صار لعملة لا تُعرض */
const FALLBACK = 'JOD';

export interface CurrencyOption {
  readonly code: string;
  readonly nameAr: string;
  /** لزرّ العملة حين يكون الموقع بالإنجليزية */
  readonly nameEn: string;
  readonly symbol: string;
}

/**
 * عملة العرض لطلب واحد. كل تحويل فيها بمعامل الدفع نفسه (fxFactor: سعر اليوم
 * عبر الدولار، والهامش حين تختلف العملتان) — فما يراه المشتري في صفحة المنتج
 * هو ما يُخصم منه في الدفع، لا سعر «تقريبي» يقفز عند السلة.
 */
export interface DisplayFx {
  readonly currency: string;
  /** من الوحدة الصغرى لـ from إلى الوحدة الصغرى لعملة العرض — null بلا سعر صرف نافذ */
  factor(from: string): number | null;
  /** المبلغ بعملة العرض — null بلا سعر صرف، فيُعرض بعملته الأصلية */
  convert(minor: bigint, from: string): bigint | null;
  /** بالدولار بلا هامش — مفتاح ترتيب واحد للفهرس بين متاجر بعملات مختلفة */
  usd(minor: bigint, from: string): number | null;
  /**
   * حدّ بعملة العرض (وحدته الصغرى) بالدولار، كما يُقارن بـ `usd` لمنتج بعملة
   * أخرى: السعر المعروض لمنتجها = دولاره × سعر العرض × (1 + الهامش).
   */
  usdBound(minor: number): number | null;
}

/**
 * عملة العرض — قرار صاحبة المشروع 18 أكتوبر 2026: المشتري يختار عملة واحدة يرى
 * بها الأسعار في الموقع كله ويدفع بها؛ الزائر الجديد يرى ما تحدّده الإدارة
 * (`default_display_currency`). المتاحة: المفعّلة التي لها سعر نافذ مقابل الدولار.
 */
@Injectable()
export class DisplayCurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async options(): Promise<{ defaultCurrency: string; currencies: CurrencyOption[] }> {
    const { defaultCurrency, currencies } = await this.snapshot(new Date());
    return { defaultCurrency, currencies };
  }

  /** العملة المطلوبة إن كانت متاحة، وإلا افتراضية الإدارة */
  async resolve(requested?: string | null, at = new Date()): Promise<DisplayFx> {
    const { defaultCurrency, currencies, rates, spreadBps } = await this.snapshot(at);
    const wanted = requested?.trim().toUpperCase();
    const currency = wanted && currencies.some((c) => c.code === wanted) ? wanted : defaultCurrency;
    const digits = minorUnitDigits(currency);
    const fx: FxInput = { orderCurrency: currency, orderDigits: digits, usdRates: rates, spreadBps };

    const factor = (from: string): number | null => {
      if (from === currency) return 1;
      try {
        return fxFactor(from, minorUnitDigits(from), fx);
      } catch {
        return null; // عملة بلا سعر نافذ — العرض بعملتها خيرٌ من صفحة ساقطة
      }
    };
    return {
      currency,
      factor,
      convert: (minor, from) => {
        const f = factor(from);
        return f === null ? null : convertMinor(minor, f);
      },
      usd: (minor, from) => usdOf(minor, from, rates),
      usdBound: (minor) => {
        const rate = rates[currency];
        return rate ? minor / 10 ** digits / rate / (1 + spreadBps / 10_000) : null;
      },
    };
  }

  /** هل يقبل المشتري هذه العملة؟ — للسلة وتفضيل الحساب */
  async isAvailable(code: string): Promise<boolean> {
    const { currencies } = await this.snapshot(new Date());
    return currencies.some((c) => c.code === code.trim().toUpperCase());
  }

  /** السعر النافذ لكل عملة مقابل الدولار — الأحدث قبل اللحظة لا الأحدث مطلقاً */
  async usdRates(at: Date): Promise<Record<string, number>> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: { baseCode: 'USD', effectiveAt: { lte: at } },
      orderBy: { effectiveAt: 'desc' },
      select: { quoteCode: true, rate: true },
    });
    // الصفوف مرتّبة بالأحدث أولاً: أول سعر لكل عملة هو النافذ
    const out: Record<string, number> = { USD: 1 };
    for (const r of rows) {
      if (r.quoteCode !== 'USD' && out[r.quoteCode] === undefined) out[r.quoteCode] = Number(r.rate);
    }
    return out;
  }

  private async snapshot(at: Date) {
    const [rows, rates, settings] = await Promise.all([
      this.prisma.currency.findMany({
        where: { isActive: true },
        orderBy: [{ sort: 'asc' }, { code: 'asc' }],
        select: { code: true, nameAr: true, nameEn: true, symbol: true },
      }),
      this.usdRates(at),
      this.prisma.setting.findMany({ where: { key: { in: ['default_display_currency', 'fx_spread_bps'] } } }),
    ]);
    const setting = (key: string): unknown => settings.find((s) => s.key === key)?.valueJson;
    // عملة بلا سعر نافذ لا تُعرض: كل سعر فيها سيسقط إلى عملة المتجر
    const currencies = rows.filter((c) => rates[c.code] !== undefined && isKnown(c.code));
    const configured = String(setting('default_display_currency') ?? '');
    const defaultCurrency = currencies.some((c) => c.code === configured)
      ? configured
      : currencies.some((c) => c.code === FALLBACK)
        ? FALLBACK
        : (currencies[0]?.code ?? FALLBACK);
    return { currencies, defaultCurrency, rates, spreadBps: Number(setting('fx_spread_bps') ?? 200) };
  }
}

/** عملة يعرف المال خاناتها — نواة money ترمي لغيرها */
function isKnown(code: string): boolean {
  try {
    minorUnitDigits(code);
    return true;
  } catch {
    return false;
  }
}

function usdOf(minor: bigint, from: string, rates: Readonly<Record<string, number>>): number | null {
  const rate = rates[from];
  if (!rate || !isKnown(from)) return null;
  return Number(minor) / 10 ** minorUnitDigits(from) / rate;
}
