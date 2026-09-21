/**
 * لقطة التسعير كما تُخزَّن على الطلب — ADR-003.
 *
 * JSON لا يحمل BigInt، فالمبالغ نصوص. التحويل في اتجاهين هنا وحده: لقطة تُقرأ
 * بـ Number في مكان ما تفقد الدقة فوق 2^53 بصمت (ADR-001).
 */
import type { Breakdown, PricedCart, PricedLine, PricedSubOrder } from '../../pricing/public';

type Stringified<T> = {
  [K in keyof T]: T[K] extends bigint
    ? string
    : T[K] extends readonly (infer U)[]
      ? Stringified<U>[]
      : T[K] extends object | null
        ? T[K] extends null
          ? null
          : Stringified<T[K]>
        : T[K];
};

export type SnapshotLine = Stringified<PricedLine>;
export type SnapshotSubOrder = Stringified<Omit<PricedSubOrder, 'lines'>> & { lines: SnapshotLine[] };
export interface Snapshot {
  readonly version: 1;
  readonly currency: string;
  readonly taxInclusive: boolean;
  readonly totals: Stringified<Breakdown>;
  readonly coupon: { code: string; discountMinor: string } | null;
  readonly subOrders: readonly SnapshotSubOrder[];
}

export function toSnapshot(cart: PricedCart): Snapshot {
  const s = (v: bigint): string => v.toString();
  const breakdown = (b: Breakdown): Stringified<Breakdown> => ({
    items: s(b.items),
    discount: s(b.discount),
    shipping: s(b.shipping),
    tax: s(b.tax),
    total: s(b.total),
  });
  return {
    version: 1,
    currency: cart.currency,
    taxInclusive: cart.taxInclusive,
    totals: breakdown(cart.totals),
    coupon: cart.coupon ? { code: cart.coupon.code, discountMinor: s(cart.coupon.discountMinor) } : null,
    subOrders: cart.subOrders.map((so) => ({
      vendorId: so.vendorId,
      vendorNameAr: so.vendorNameAr,
      currency: so.currency,
      vendor: breakdown(so.vendor),
      charge: breakdown(so.charge),
      commissionMinor: s(so.commissionMinor),
      vendorNetMinor: s(so.vendorNetMinor),
      fxRateSnapshot: so.fxRateSnapshot,
      shipping: so.shipping,
      lines: so.lines.map((l) => ({
        variantId: l.variantId,
        productId: l.productId,
        vendorId: l.vendorId,
        categoryId: l.categoryId,
        nameAr: l.nameAr,
        variantLabel: l.variantLabel,
        sku: l.sku,
        imageKey: l.imageKey,
        unitPriceMinor: s(l.unitPriceMinor),
        qty: l.qty,
        weightGrams: l.weightGrams,
        commissionBps: l.commissionBps,
        lineSubtotal: s(l.lineSubtotal),
        lineDiscount: s(l.lineDiscount),
        lineTax: s(l.lineTax),
        lineTotal: s(l.lineTotal),
        commissionMinor: s(l.commissionMinor),
      })),
    })),
  };
}

/** رقم طلب يقرؤه إنسان على الهاتف: بلا حروف متشابهة (0/O، 1/I) */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function orderNumber(now: Date, random: () => number = Math.random): string {
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  let tail = '';
  for (let i = 0; i < 6; i++) tail += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `BST-${date}-${tail}`;
}
