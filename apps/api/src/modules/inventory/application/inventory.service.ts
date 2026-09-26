import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  InsufficientStockError,
  NotFoundError,
  ReservationExpiredError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  assertInitialStock,
  assertThreshold,
  availableOf,
  lowStockTransition,
  normalizeReservationLines,
  planAdjustment,
  type MovementReason,
  type ReservationLineInput,
  type StockChange,
} from '../domain/stock';

export type Tx = Prisma.TransactionClient;

/** يطابق القيمة الافتراضية في المخطط */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const DEFAULT_TTL_MINUTES = 15;
export const EXPIRE_BATCH = 500;

export interface MovementContext {
  readonly reason: MovementReason;
  readonly actorUserId?: string | null | undefined;
  readonly refType?: string | null | undefined;
  readonly refId?: string | null | undefined;
  readonly note?: string | null | undefined;
}

export interface StockView {
  readonly variantId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly lowStockThreshold: number;
  readonly isLow: boolean;
  readonly lowStockSince: Date | null;
}

export interface ReservationResult {
  readonly expiresAt: Date;
  readonly reservations: readonly { id: string; variantId: string; qty: number }[];
}

interface LockedRow {
  variantId: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  lowStockSince: Date | null;
}

const toView = (r: LockedRow): StockView => ({
  variantId: r.variantId,
  onHand: r.onHand,
  reserved: r.reserved,
  available: availableOf(r),
  lowStockThreshold: r.lowStockThreshold,
  isLow: r.lowStockSince !== null,
  lowStockSince: r.lowStockSince,
});

/**
 * المخزون والحجوزات — ADR-006.
 *
 * كل كتابة تمرّ بثلاث خطوات لا تُختصر:
 *   1. قفل صفوف المخزون `FOR UPDATE` بترتيب variantId تصاعدياً
 *   2. قرار من domain/stock على القيم المقفولة
 *   3. الكتابة: الصف + حركة للإضافة فقط + علامة العتبة
 *
 * القفل هو ما يجعل «طلبان على آخر قطعة» يُفصل فيه بالتسلسل لا بالحظ.
 * قيد CHECK (reserved <= onHand) في القاعدة حزام ثانٍ لا الحارس الأول.
 *
 * الوحدة لا تعرف المنتجات ولا البائعين: الملكية يتحقق منها المستدعي،
 * واسم المنتج في رسالة النفاد يمرّره هو.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** داخل معاملة المستدعي إن مُرّرت — الكتالوج ينشئ المنتج ومخزونه في معاملة واحدة. */
  private within<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 20_000,
    });
  }

  private async lock(tx: Tx, variantIds: readonly string[]): Promise<Map<string, LockedRow>> {
    const ids = [...new Set(variantIds)].sort();
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT "variantId", "onHand", "reserved", "lowStockThreshold", "lowStockSince"
      FROM "inventory"
      WHERE "variantId" = ANY(${ids}::uuid[])
      ORDER BY "variantId"
      FOR UPDATE`;
    return new Map(rows.map((r) => [r.variantId, r]));
  }

  private movement(variantId: string, delta: number, ctx: MovementContext) {
    return {
      variantId,
      delta,
      reason: ctx.reason,
      refType: ctx.refType ?? null,
      refId: ctx.refId ?? null,
      actorUserId: ctx.actorUserId ?? null,
      note: ctx.note ?? null,
    };
  }

  // ---------------------------------------------------------------- الإنشاء

  /**
   * مخزون متغيّرات جديدة: صف لكل متغيّر وحركة لكل كمية موجبة.
   * بلا الحركة ينحرف مجموع الحركات عن onHand من اللحظة الأولى (INV-04).
   */
  async initialize(
    tx: Tx,
    items: readonly {
      readonly variantId: string;
      readonly onHand: number;
      readonly lowStockThreshold?: number | null | undefined;
    }[],
    ctx: MovementContext,
  ): Promise<void> {
    if (items.length === 0) return;
    const now = new Date();

    const rows = items.map((item) => {
      assertInitialStock(item.onHand);
      const threshold = item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      assertThreshold(threshold);
      return {
        variantId: item.variantId,
        onHand: item.onHand,
        lowStockThreshold: threshold,
        lowStockSince: item.onHand <= threshold ? now : null,
      };
    });

    await tx.inventory.createMany({ data: rows });

    const movements = items
      .filter((i) => i.onHand > 0)
      .map((i) => this.movement(i.variantId, i.onHand, ctx));
    if (movements.length > 0) await tx.inventoryMovement.createMany({ data: movements });
  }

  // ---------------------------------------------------------------- التعديل

  /**
   * تعديل يدوي أو من استيراد. `setTo` جرد فعلي، و `delta` حدث (تلف، مرتجع).
   * خفض المخزون تحت المحجوز مرفوض: تلك القطع وُعد بها مشترٍ في صفحة الدفع.
   */
  async adjust(
    input: {
      readonly variantId: string;
      readonly change: StockChange;
      readonly lowStockThreshold?: number | null | undefined;
    },
    ctx: MovementContext,
    tx?: Tx,
  ): Promise<StockView> {
    return this.within(tx, async (t) => {
      const row = (await this.lock(t, [input.variantId])).get(input.variantId);
      if (!row) {
        throw new NotFoundError('لا سجل مخزون لهذا المتغيّر.', { variantId: input.variantId });
      }

      const threshold = input.lowStockThreshold ?? row.lowStockThreshold;
      assertThreshold(threshold);

      const plan = planAdjustment({ ...row, lowStockThreshold: threshold }, input.change);
      const transition = lowStockTransition(plan.onHand, threshold, row.lowStockSince !== null);
      const lowStockSince =
        transition === 'entered' ? new Date() : transition === 'left' ? null : row.lowStockSince;

      const next: LockedRow = { ...row, onHand: plan.onHand, lowStockThreshold: threshold, lowStockSince };
      if (plan.delta === 0 && threshold === row.lowStockThreshold && transition === 'unchanged') {
        return toView(next);
      }

      await t.inventory.update({
        where: { variantId: input.variantId },
        data: {
          onHand: plan.onHand,
          lowStockThreshold: threshold,
          lowStockSince,
          version: { increment: 1 },
        },
      });
      if (plan.delta !== 0) {
        await t.inventoryMovement.create({ data: this.movement(input.variantId, plan.delta, ctx) });
      }
      return toView(next);
    });
  }

  // ---------------------------------------------------------------- الحجز

  private async ttlMinutes(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'reservation_ttl_minutes' },
    });
    const value = Number(setting?.valueJson);
    // قيمة تالفة في الإعدادات لا تجمّد المخزون ساعات ولا تُسقط كل حجز فوراً
    return Number.isInteger(value) && value >= 1 && value <= 120 ? value : DEFAULT_TTL_MINUTES;
  }

  /**
   * الحجز لحظة دخول صفحة الدفع — كل الأسطر أو لا شيء.
   *
   * سطر ناقص واحد يُسقط الحجز كله برسالة تسمّيه: مشترٍ حُجز له نصف سلّته
   * يدفع ثم يكتشف النقص، وهذا ما وُجد ADR-006 لمنعه.
   */
  async reserve(input: {
    readonly lines: readonly ReservationLineInput[];
    readonly cartId?: string | null | undefined;
    readonly orderId?: string | null | undefined;
    readonly now?: Date | undefined;
  }): Promise<ReservationResult> {
    const lines = normalizeReservationLines(input.lines);
    const ttl = await this.ttlMinutes();

    return this.within(undefined, async (t) => {
      const locked = await this.lock(
        t,
        lines.map((l) => l.variantId),
      );

      for (const line of lines) {
        const row = locked.get(line.variantId);
        const available = row ? availableOf(row) : 0;
        if (available < line.qty) throw new InsufficientStockError(line.label, available);
      }

      const now = input.now ?? new Date();
      const expiresAt = new Date(now.getTime() + ttl * 60_000);
      const reservations = lines.map((l) => ({
        id: randomUUID(),
        variantId: l.variantId,
        qty: l.qty,
        cartId: input.cartId ?? null,
        orderId: input.orderId ?? null,
        expiresAt,
      }));

      await t.stockReservation.createMany({ data: reservations });
      for (const l of lines) {
        await t.inventory.update({
          where: { variantId: l.variantId },
          data: { reserved: { increment: l.qty }, version: { increment: 1 } },
        });
      }

      return {
        expiresAt,
        reservations: reservations.map((r) => ({ id: r.id, variantId: r.variantId, qty: r.qty })),
      };
    });
  }

  /** إلغاء أو فشل دفع. عديم الأثر عند التكرار: الحجز غير النشط لا يُحرَّر مرتين. */
  release(reservationIds: readonly string[], tx?: Tx): Promise<number> {
    return this.within(tx, async (t) => {
      const settled = await this.settle(t, reservationIds, 'released');
      return settled.length;
    });
  }

  /**
   * مهمة كل دقيقة — S-03. دفعة واحدة؛ المستدعي يكرّر ما دامت ممتلئة.
   * تشغيلها من نسختين في اللحظة نفسها آمن: شرط status = 'active' بعد القفل يحسم.
   */
  expireDue(now: Date = new Date()): Promise<number> {
    return this.within(undefined, async (t) => {
      const due = await t.stockReservation.findMany({
        where: { status: 'active', expiresAt: { lt: now } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: EXPIRE_BATCH,
      });
      if (due.length === 0) return 0;
      const settled = await this.settle(
        t,
        due.map((d) => d.id),
        'expired',
        now,
      );
      return settled.length;
    });
  }

  /**
   * نجاح الدفع: الحجز يصير بيعاً. onHand و reserved ينقصان معاً، وحركة sale.
   * حجز انتهى قبل التثبيت يُسقط العملية كلها — المنسّق (المرحلة 08) يعيد الحجز أو يلغي التفويض.
   */
  commit(
    reservationIds: readonly string[],
    ctx: { readonly orderId: string; readonly actorUserId?: string | null | undefined },
    tx?: Tx,
  ): Promise<number> {
    return this.within(tx, async (t) => {
      const ids = [...new Set(reservationIds)];
      const candidates = await t.stockReservation.findMany({
        where: { id: { in: ids } },
        select: { variantId: true },
      });
      const locked = await this.lock(
        t,
        candidates.map((c) => c.variantId),
      );

      const done = await t.$queryRaw<{ variantId: string; qty: number }[]>`
        UPDATE "stock_reservations"
        SET "status" = 'committed', "committedAt" = now(), "orderId" = ${ctx.orderId}::uuid
        WHERE "id" = ANY(${ids}::uuid[]) AND "status" = 'active'
        RETURNING "variantId", "qty"`;

      if (done.length !== ids.length) throw new ReservationExpiredError();

      const now = new Date();
      for (const [variantId, qty] of sumByVariant(done)) {
        const row = locked.get(variantId);
        if (!row) throw new NotFoundError('لا سجل مخزون لهذا المتغيّر.', { variantId });
        const onHand = row.onHand - qty;
        const transition = lowStockTransition(onHand, row.lowStockThreshold, row.lowStockSince !== null);
        await t.inventory.update({
          where: { variantId },
          data: {
            onHand: { decrement: qty },
            reserved: { decrement: qty },
            version: { increment: 1 },
            ...(transition === 'entered' ? { lowStockSince: now } : {}),
            ...(transition === 'left' ? { lowStockSince: null } : {}),
          },
        });
        await t.inventoryMovement.create({
          data: this.movement(variantId, -qty, {
            reason: 'sale',
            refType: 'order',
            refId: ctx.orderId,
            actorUserId: ctx.actorUserId,
          }),
        });
      }
      return done.length;
    });
  }

  /**
   * يغلق حجوزات نشطة ويُنقص reserved بقدرها.
   * يقفل صفوف المخزون **قبل** تحديث الحجوزات: الترتيب نفسه في كل مسار يمنع التعطّل المتبادل.
   */
  private async settle(
    t: Tx,
    reservationIds: readonly string[],
    to: 'released' | 'expired',
    expiredBefore?: Date,
  ): Promise<{ variantId: string; qty: number }[]> {
    const ids = [...new Set(reservationIds)];
    if (ids.length === 0) return [];

    const candidates = await t.stockReservation.findMany({
      where: { id: { in: ids }, status: 'active' },
      select: { variantId: true },
    });
    if (candidates.length === 0) return [];
    await this.lock(
      t,
      candidates.map((c) => c.variantId),
    );

    const done = expiredBefore
      ? await t.$queryRaw<{ variantId: string; qty: number }[]>`
          UPDATE "stock_reservations"
          SET "status" = 'expired', "releasedAt" = now()
          WHERE "id" = ANY(${ids}::uuid[]) AND "status" = 'active' AND "expiresAt" < ${expiredBefore}
          RETURNING "variantId", "qty"`
      : await t.$queryRaw<{ variantId: string; qty: number }[]>`
          UPDATE "stock_reservations"
          SET "status" = ${to}::"ReservationStatus", "releasedAt" = now()
          WHERE "id" = ANY(${ids}::uuid[]) AND "status" = 'active'
          RETURNING "variantId", "qty"`;

    for (const [variantId, qty] of sumByVariant(done)) {
      await t.inventory.update({
        where: { variantId },
        data: { reserved: { decrement: qty }, version: { increment: 1 } },
      });
    }
    return done;
  }

  // ---------------------------------------------------------------- القراءة

  async levels(variantIds: readonly string[]): Promise<StockView[]> {
    if (variantIds.length === 0) return [];
    const rows = await this.prisma.inventory.findMany({
      where: { variantId: { in: [...variantIds] } },
      select: {
        variantId: true,
        onHand: true,
        reserved: true,
        lowStockThreshold: true,
        lowStockSince: true,
      },
    });
    return rows.map(toView);
  }

  // ---------------------------------------------------------- تنبيه النفاد

  /**
   * ما بلغ العتبة ولم يُنبَّه عنه بائعه بعد، الأقدم أولاً. المخزون لا يعرف
   * البائع ولا المنتج — يعطي الصفوف، والكتالوج ينبّه (SRS V-04).
   */
  async pendingLowStock(limit = EXPIRE_BATCH): Promise<StockView[]> {
    const rows = await this.prisma.$queryRaw<LockedRow[]>`
      SELECT "variantId", "onHand", "reserved", "lowStockThreshold", "lowStockSince"
      FROM "inventory"
      WHERE "lowStockSince" IS NOT NULL
        AND ("lowStockNotifiedAt" IS NULL OR "lowStockNotifiedAt" < "lowStockSince")
      ORDER BY "lowStockSince" ASC
      LIMIT ${limit}::int`;
    return rows.map(toView);
  }

  /**
   * يحجز الصفوف للتنبيه ويعيد ما حُجز فعلاً. الشرط داخل التحديث نفسه:
   * جولتان متزامنتان على الصف نفسه تحجزه إحداهما وحدها، فلا يصل البائعَ
   * تنبيهان عن نزول واحد. يُستدعى داخل معاملة إدراج التنبيه.
   */
  async claimLowStockAlerts(variantIds: readonly string[], tx?: Tx): Promise<string[]> {
    if (variantIds.length === 0) return [];
    const db = tx ?? this.prisma;
    const claimed = await db.$queryRaw<{ variantId: string }[]>`
      UPDATE "inventory"
      SET "lowStockNotifiedAt" = now()
      WHERE "variantId" = ANY(${[...variantIds]}::uuid[])
        AND "lowStockSince" IS NOT NULL
        AND ("lowStockNotifiedAt" IS NULL OR "lowStockNotifiedAt" < "lowStockSince")
      RETURNING "variantId"`;
    return claimed.map((r) => r.variantId);
  }

  /** ما بلغ العتبة من هذه المتغيّرات، الأقدم أولاً — مصدر تنبيه البائع. */
  async lowStock(variantIds: readonly string[]): Promise<StockView[]> {
    if (variantIds.length === 0) return [];
    const rows = await this.prisma.inventory.findMany({
      where: { variantId: { in: [...variantIds] }, lowStockSince: { not: null } },
      orderBy: { lowStockSince: 'asc' },
      select: {
        variantId: true,
        onHand: true,
        reserved: true,
        lowStockThreshold: true,
        lowStockSince: true,
      },
    });
    return rows.map(toView);
  }
}

function sumByVariant(rows: readonly { variantId: string; qty: number }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.variantId, (totals.get(r.variantId) ?? 0) + Number(r.qty));
  return new Map([...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
