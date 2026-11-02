import { Prisma } from '@prisma/client';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error';
import { everyAfterBoot } from '../../../common/periodic';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OrderLifecycleService } from '../../orders/public';
import {
  CARRIER,
  SELF_DELIVERY,
  TRACKING_LABELS,
  TRACKING_ORDER,
  currentAttempt,
  nextCode,
  type CarrierProvider,
  type TrackingCode,
  type Waybill,
} from '../domain/carrier';

const EVERY_TEN_MINUTES = 600_000;

/**
 * البوليصة والتتبّع — VD-14 و ST-19.
 *
 * حدث «سُلّم» من شركة الشحن يمرّ عبر آلة الحالات بفاعل `carrier` — لا
 * يكتب الحالة مباشرة، فيُرفض كما يُرفض أي انتقال غير مسموح.
 *
 * بلا شركة موصولة (SHIPPING_CARRIER=none) التوصيل ذاتي وحده: لا بوليصة، ولا
 * أحداث شركة، ولا مهمة تتقدّم بالشحنات — البائع يؤكّد التسليم بنفسه.
 */
@Injectable()
export class TrackingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Tracking');
  private stop: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CARRIER) private readonly carrier: CarrierProvider | null,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  onApplicationBootstrap(): void {
    // لا شركة = لا مهمة تعلّم شحنة مستلمة لم يسلّمها أحد
    if (!this.carrier || process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.stop = everyAfterBoot(() => void this.advanceAll().catch((e) => this.logger.error(e)), EVERY_TEN_MINUTES);
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  carriers(): { code: string; nameAr: string }[] {
    return [
      ...(this.carrier ? [{ code: this.carrier.code, nameAr: this.carrier.nameAr }] : []),
      { code: SELF_DELIVERY, nameAr: 'توصيل ذاتي' },
    ];
  }

  /**
   * بوليصة لطلب جاهز أو قيد التجهيز، أو تعذّر توصيله فيُعاد شحنه — لطلب البائع نفسه وحده.
   * كان الزرّ يظهر على «تعذّر التوصيل» والخادم يرفضه (VOPS-035)
   */
  async createWaybill(vendorId: string, subOrderId: string): Promise<Waybill> {
    const carrier = this.carrier;
    if (!carrier) {
      throw new ConflictError('لا شركة شحن موصولة — التوصيل ذاتي: اكتب مرجع توصيلك وأكّد الشحن.', { subOrderId });
    }
    const sub = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, vendorId },
      select: { subOrderNumber: true, status: true, order: { select: { shippingAddressSnapshot: true } } },
    });
    if (!sub) throw new NotFoundError('الطلب غير موجود.', { subOrderId });
    if (sub.status !== 'preparing' && sub.status !== 'ready_to_ship' && sub.status !== 'delivery_failed') {
      throw new ConflictError('البوليصة تُصدر للطلب قيد التجهيز أو الجاهز للشحن أو الذي تعذّر توصيله.', { status: sub.status });
    }
    const addr = (sub.order.shippingAddressSnapshot ?? {}) as Record<string, string>;
    // الرقم فريد لكل شركة (shipments_carrier_tracking_key): تصادم نادر يُعاد برقم جديد
    for (let attempt = 0; ; attempt++) {
      const waybill = await carrier.createWaybill({
        subOrderNumber: sub.subOrderNumber,
        recipient: addr['recipientName'] ?? '',
        city: addr['city'] ?? '',
      });
      try {
        await this.prisma.shipment.upsert({
          where: { subOrderId },
          create: { subOrderId, carrierCode: waybill.carrierCode, trackingNumber: waybill.trackingNumber, status: 'created' },
          update: { carrierCode: waybill.carrierCode, trackingNumber: waybill.trackingNumber, status: 'created' },
        });
        return waybill;
      } catch (err) {
        if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }

  /**
   * حدث من شركة الشحن. لا يعود للخلف، ولا يُسجَّل مرتين. «سُلّم» و«تعذّر»
   * ينقلان الفرعي عبر آلة الحالات.
   */
  async record(trackingNumber: string, code: TrackingCode, at: Date = new Date(), location?: string): Promise<boolean> {
    if (!this.carrier) throw new NotFoundError('لا شركة شحن موصولة تُرسل أحداثاً.', { trackingNumber });
    // حدث الشركة لشحنتها هي: رقم يكتبه بائع لتوصيله الذاتي قد يطابق رقمها
    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNumber, carrierCode: this.carrier.code },
      select: { id: true, subOrderId: true, status: true, shippedAt: true, events: { select: { code: true, occurredAt: true } } },
    });
    if (!shipment) throw new NotFoundError('رقم تتبّع غير معروف.', { trackingNumber });
    // الشحنة المعادة بعد «تعذّر» تبدأ من جديد: «استلمت الشركة» الأولى لا تمنع الثانية
    const events = currentAttempt(shipment.events, shipment.shippedAt);
    if (events.some((e) => e.code === code)) return false;
    const reached = Math.max(-1, ...events.map((e) => TRACKING_ORDER.indexOf(e.code as TrackingCode)));
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
    if (!this.carrier) return 0;
    const moving = await this.prisma.shipment.findMany({
      where: { carrierCode: this.carrier.code, subOrder: { status: 'shipped' } },
      select: { trackingNumber: true, shippedAt: true, events: { select: { code: true, occurredAt: true }, orderBy: { occurredAt: 'asc' } } },
      take: 200,
    });
    let n = 0;
    for (const s of moving) {
      const last = currentAttempt(s.events, s.shippedAt).at(-1);
      const next = nextCode((last?.code as TrackingCode | undefined) ?? null);
      if (next && (await this.record(s.trackingNumber, next).catch(() => false))) n++;
    }
    return n;
  }

  /** تتبّع عام برقم الشحنة: الأحداث وحدها — لا اسم ولا عنوان */
  async track(trackingNumber: string) {
    // التتبّع العام لشحنات الشركات: رقم التوصيل الذاتي مرجع البائع، يتكرّر بين البائعين
    // فيُظهر شحنة غيرك — ولا أحداث له من شركة أصلاً
    const s = await this.prisma.shipment.findFirst({
      where: { trackingNumber, carrierCode: { not: SELF_DELIVERY } },
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
    // الرقم الجديد بعد إعادة الشحن بمحاولته وحدها — كان يُظهر «تعذّر التوصيل» أعلى طردٍ في طريقه
    return { ...s, events: currentAttempt(s.events, s.shippedAt), carrierName: carrier?.nameAr ?? s.carrierCode };
  }
}
