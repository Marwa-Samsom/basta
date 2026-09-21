import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProviderEvent } from '../domain/provider';

/**
 * سجل إشعارات البوابة — ADR-011.
 *
 * **القيد الفريد على (provider, providerEventId) هو وحده ما يمنع طلباً مكرراً.**
 * البوابات تعيد الإرسال عمداً حين لا يصلها 200 في الوقت، فإشعار «نجح الدفع»
 * قد يصل مرتين في الثانية نفسها. الإدراج الأول يفوز، والثاني يسمع «مكرّر»
 * فلا يُعالَج — بلا قفل تطبيقي يُنسى في مسار ما.
 */
@Injectable()
export class PaymentEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `true` إن كان الإشعار جديداً ويجب معالجته، `false` إن سبق تسجيله. */
  async record(provider: string, event: ProviderEvent, paymentId: string | null): Promise<boolean> {
    try {
      await this.prisma.paymentEvent.create({
        data: {
          provider,
          providerEventId: event.eventId,
          type: event.type,
          paymentId,
          payloadJson: {
            ...event,
            amountMinor: event.amountMinor.toString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  async markProcessed(provider: string, eventId: string): Promise<void> {
    await this.prisma.paymentEvent.updateMany({
      where: { provider, providerEventId: eventId },
      data: { processedAt: new Date() },
    });
  }
}
