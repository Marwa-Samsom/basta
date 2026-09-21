import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OrderLifecycleService } from '../../orders/public';
import {
  TRACKING_LABELS,
  TRACKING_ORDER,
  nextCode,
  type TrackingCode,
  type Waybill,
} from '../domain/carrier';
import { FakeCarrier } from '../infrastructure/fake-carrier';

const EVERY_TEN_MINUTES = 600_000;

/**
 * البوليصة والتتبّع — VD-14 و ST-19.
 *
 * حدث «سُلّم» من شركة الشحن يمرّ عبر آلة الحالات بفاعل `carrier` — لا
 * يكتب الحالة مباشرة، فيُرفض كما يُرفض أي انتقال غير مسموح.
 */
@Injectable()
export class TrackingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Tracking');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly carrier: FakeCarrier,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.timer = setInterval(() => void this.advanceAll().catch((e) => this.logger.error(e)), EVERY_TEN_MINUTES);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  carriers(): { code: string; nameAr: string }[] {
    return [
      { code: this.carrier.code, nameAr: this.carrier.nameAr },
      { code: 'self', nameAr: 'توصيل ذاتي' },
    ];
  }

  /** بوليصة لطلب جاهز أو قيد التجهيز — لطلب البائع نفسه وحده */
  async createWaybill(vendorId: string, subOrderId: string): Promise<Waybill> {
    const sub = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, vendorId },
      select: { subOrderNumber: true, status: true, order: { select: { shippingAddressSnapshot: true } } },
    });
    if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    if (sub.status !== 'preparing' && sub.status !== 'ready_to_ship') {
      throw new ConflictError('البوليصة تُصدر للطلب قيد التجهيز أو الجاهز للشحن.', { status: sub.status });
    }
    const addr = (sub.order.shippingAddressSnapshot ?? {}) as Record<string, string>;
    const waybill = await this.carrier.createWaybill({
      subOrderNumber: sub.subOrderNumber,
      recipient: addr['recipientName'] ?? '',
      city: addr['city'] ?? '',
    });
    await this.prisma.shipment.upsert({
      where: { subOrderId },
      create: { subOrderId, carrierCode: waybill.carrierCode, trackingNumber: waybill.trackingNumber, status: 'created' },
      update: { carrierCode: waybill.carrierCode, trackingNumber: waybill.trackingNumber, status: 'created' },
    });
    return waybill;
  }

  /**
   * حدث من شركة الشحن. لا يعود للخلف، ولا يُسجَّل مرتين. «سُلّم» و«تعذّر»
   * ينقلان الفرعي عبر آلة الحالات.
   */
  async record(trackingNumber: string, code: TrackingCode, at: Date = new Date(), location?: string): Promise<boolean> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNumber },
      select: { id: true, subOrderId: true, status: true, events: { select: { code: true } } },
    });
    if (!shipment) throw new NotFoundError('رقم تتبّع غير معروف.', { trackingNumber });
    if (shipment.events.some((e) => e.code === code)) return false;
    const reached = Math.max(-1, ...shipment.events.map((e) => TRACKING_ORDER.indexOf(e.code as TrackingCode)));
    if (code !== 'failed' && TRACKING_ORDER.indexOf(code) <= reached) return false;

    await this.prisma.shipmentEvent.create({
      data: { shipmentId: shipment.id, code, descriptionAr: TRACKING_LABELS[code], location: location ?? null, occurredAt: at },
    });
    await this.prisma.shipment.update({ where: { id: shipment.id }, data: { status: code } });

    if (code === 'delivered') {
      await this.lifecycle.transition(shipment.subOrderId, 'delivered', { kind: 'carrier', userId: null });
    }
    if (code === 'failed') {
      await this.lifecycle.transition(shipment.subOrderId, 'delivery_failed', { kind: 'carrier', userId: null });
    }
    return true;
  }

  /** مهمة الشركة الوهمية: كل شحنة مشحونة تتقدّم خطوة */
  async advanceAll(): Promise<number> {
    const moving = await this.prisma.shipment.findMany({
      where: { carrierCode: this.carrier.code, subOrder: { status: 'shipped' } },
      select: { trackingNumber: true, events: { select: { code: true }, orderBy: { occurredAt: 'desc' }, take: 1 } },
      take: 200,
    });
    let n = 0;
    for (const s of moving) {
      const next = nextCode((s.events[0]?.code as TrackingCode | undefined) ?? null);
      if (next && (await this.record(s.trackingNumber, next).catch(() => false))) n++;
    }
    return n;
  }

  /** تتبّع عام برقم الشحنة: الأحداث وحدها — لا اسم ولا عنوان */
  async track(trackingNumber: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { trackingNumber },
      select: {
        carrierCode: true,
        trackingNumber: true,
        status: true,
        shippedAt: true,
        deliveredAt: true,
        events: { orderBy: { occurredAt: 'desc' }, select: { code: true, descriptionAr: true, location: true, occurredAt: true } },
      },
    });
    if (!s) throw new NotFoundError('رقم تتبّع غير معروف.', { trackingNumber });
    const carrier = this.carriers().find((c) => c.code === s.carrierCode);
    return { ...s, carrierName: carrier?.nameAr ?? s.carrierCode };
  }
}
