import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * المراجعات الموثّقة — ST-22.
 *
 * التوثيق بنية لا حقل: المراجعة مربوطة بسطر طلب (`orderItemId` فريد)، والسطر
 * لا يُراجَع إلا من صاحب الطلب بعد التسليم. لا طريق لمراجعة بلا شراء، ولا
 * لمراجعتين على شراء واحد.
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    input: { orderItemId: string; rating: number; title?: string | null; body?: string | null },
  ): Promise<{ id: string }> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new InvalidInputError('التقييم من 1 إلى 5.');
    }
    const item = await this.prisma.orderItem.findFirst({
      where: { id: input.orderItemId, order: { customerUserId: userId } },
      select: { productId: true, vendorId: true, qty: true, refundedQty: true, subOrder: { select: { status: true } } },
    });
    if (!item) throw new NotFoundError('لا شراء بهذا السطر في حسابك.', { orderItemId: input.orderItemId });
    if (item.subOrder.status !== 'delivered' && item.subOrder.status !== 'completed') {
      throw new ConflictError('المراجعة بعد استلام الطلب.');
    }
    if (item.refundedQty >= item.qty) throw new ConflictError('أُرجع هذا المنتج كاملاً — لا مراجعة عليه.');

    try {
      return await this.prisma.review.create({
        data: {
          orderItemId: input.orderItemId,
          productId: item.productId,
          vendorId: item.vendorId,
          userId,
          rating: input.rating,
          title: input.title?.trim() || null,
          body: input.body?.trim() || null,
          status: 'published',
        },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('راجعت هذا الشراء من قبل.');
      }
      throw err;
    }
  }

  async forProduct(productId: string, page = 1) {
    const where = { productId, status: 'published' };
    const [rows, agg, dist] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * 10,
        take: 10,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          createdAt: true,
          user: { select: { fullName: true } },
          orderItem: { select: { variantLabelSnapshot: true } },
        },
      }),
      this.prisma.review.aggregate({ where, _avg: { rating: true }, _count: true }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: true }),
    ]);
    return {
      average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
      count: agg._count,
      distribution: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [r, dist.find((d) => d.rating === r)?._count ?? 0])),
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        createdAt: r.createdAt,
        // الاسم الأول وحده — خصوصية المشتري
        author: (r.user.fullName ?? 'مشترٍ').split(/\s+/)[0],
        variant: r.orderItem.variantLabelSnapshot,
        verified: true,
      })),
    };
  }
}
