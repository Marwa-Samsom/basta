import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { like, pageArgs } from '../../../common/paging';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Snapshot } from '../domain/snapshot';

/**
 * طابور التحويلات الواردة للإدارة — ما ينتظر التأكيد، وما أُكّد.
 *
 * المُدير يطابق كشف البنك بهذه القائمة: رقم الطلب (يكتبه المشتري في ملاحظة التحويل)
 * والمبلغ واسم صاحب الحساب. الأقرب انتهاءً أولاً: ما سيُلغى بعد قليل يُرى قبل غيره.
 *
 * القائمتان تُقرآن خمسين خمسين ببحث (20 أكتوبر 2026): كانت الواردة تقف عند مئتين والمؤكَّدة
 * عند آخر عشرين، فالتحويل الذي في الكشف ولا يظهر هنا لا يُطابَق.
 */
@Injectable()
export class TransferQueueService {
  constructor(private readonly prisma: PrismaService) {}

  /** الواردة — البحث برقم الطلب أو اسم المشتري أو بريده أو جواله */
  async waiting(q: { search?: string; page: number }, now: Date = new Date()) {
    const t = q.search;
    const where: Prisma.OrderWhereInput = {
      status: 'pending_payment',
      payment: { is: { status: 'awaiting_transfer' } },
      ...(t
        ? {
            OR: [
              { orderNumber: like(t) },
              { guestEmail: like(t) },
              {
                customer: {
                  OR: [{ fullName: like(t) }, { email: like(t) }, { phone: { contains: t } }],
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(q.page),
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
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((o) => {
        const address = o.shippingAddressSnapshot as {
          recipientName?: string;
          phone?: string;
        } | null;
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
      total,
    };
  }

  /** ما أُكّد، الأحدث أولاً — البحث برقم الطلب أو مرجع التحويل أو اسم المشتري أو بريده */
  async confirmed(q: { search?: string; page: number }) {
    const t = q.search;
    const where: Prisma.PaymentWhereInput = {
      transferReference: { not: null },
      ...(t
        ? {
            OR: [
              { transferReference: like(t) },
              {
                order: {
                  OR: [
                    { orderNumber: like(t) },
                    { customer: { OR: [{ fullName: like(t) }, { email: like(t) }] } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(q.page),
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
      this.prisma.payment.count({ where }),
    ]);

    const confirmers = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(rows.map((p) => p.confirmedBy).filter((id): id is string => id !== null)),
          ],
        },
      },
      select: { id: true, fullName: true },
    });

    return {
      items: rows.map((p) => ({
        orderNumber: p.order.orderNumber,
        buyerName: p.order.customer?.fullName ?? null,
        amountMinorUnits: p.amountMinorUnits.toString(),
        currency: p.currency,
        reference: p.transferReference,
        note: p.transferNote,
        confirmedAt: p.confirmedAt,
        confirmedBy: confirmers.find((u) => u.id === p.confirmedBy)?.fullName ?? null,
      })),
      total,
    };
  }
}
