import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Snapshot } from '../domain/snapshot';

const RECENT = 20;

/**
 * طابور التحويلات الواردة للإدارة — ما ينتظر التأكيد، وآخر ما أُكّد.
 *
 * المُدير يطابق كشف البنك بهذه القائمة: رقم الطلب (يكتبه المشتري في ملاحظة التحويل)
 * والمبلغ واسم صاحب الحساب. الأقرب انتهاءً أولاً: ما سيُلغى بعد قليل يُرى قبل غيره.
 */
@Injectable()
export class TransferQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(now: Date = new Date()) {
    const [waiting, confirmed] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: 'pending_payment', payment: { is: { status: 'awaiting_transfer' } } },
        orderBy: { placedAt: 'asc' },
        take: 200,
        select: {
          orderNumber: true,
          placedAt: true,
          grandTotalMinorUnits: true,
          currency: true,
          shippingAddressSnapshot: true,
          pricingSnapshot: true,
          customer: { select: { fullName: true, email: true, phone: true } },
          payment: { select: { expiresAt: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { transferReference: { not: null } },
        orderBy: { confirmedAt: 'desc' },
        take: RECENT,
        select: {
          amountMinorUnits: true,
          currency: true,
          transferReference: true,
          transferNote: true,
          confirmedAt: true,
          confirmedBy: true,
          order: { select: { orderNumber: true, customer: { select: { fullName: true } } } },
        },
      }),
    ]);

    const confirmers = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(confirmed.map((p) => p.confirmedBy).filter((id): id is string => id !== null))] } },
      select: { id: true, fullName: true },
    });

    return {
      waiting: waiting.map((o) => {
        const address = o.shippingAddressSnapshot as { recipientName?: string; phone?: string } | null;
        const snapshot = o.pricingSnapshot as unknown as Snapshot | null;
        return {
          orderNumber: o.orderNumber,
          placedAt: o.placedAt,
          expiresAt: o.payment?.expiresAt ?? null,
          expired: !!o.payment?.expiresAt && o.payment.expiresAt <= now,
          amountMinorUnits: o.grandTotalMinorUnits.toString(),
          currency: o.currency,
          storeCount: snapshot?.subOrders.length ?? 0,
          buyer: {
            name: o.customer?.fullName ?? address?.recipientName ?? null,
            email: o.customer?.email ?? null,
            phone: address?.phone ?? o.customer?.phone ?? null,
          },
        };
      }),
      confirmed: confirmed.map((p) => ({
        orderNumber: p.order.orderNumber,
        buyerName: p.order.customer?.fullName ?? null,
        amountMinorUnits: p.amountMinorUnits.toString(),
        currency: p.currency,
        reference: p.transferReference,
        note: p.transferNote,
        confirmedAt: p.confirmedAt,
        confirmedBy: confirmers.find((u) => u.id === p.confirmedBy)?.fullName ?? null,
      })),
    };
  }
}
