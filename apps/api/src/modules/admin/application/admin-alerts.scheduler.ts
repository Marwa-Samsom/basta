import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { writeErrorLog } from '../../../common/observability/error-log';
import { everyAfterBoot } from '../../../common/periodic';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/public';
import { acceptBy, acceptanceDueSince } from '../domain/acceptance';
import { ReportsService } from './reports.service';

const EVERY_TEN_MINUTES = 10 * 60_000;
/** منظرات التدقيق أثقل من غيرها: مرة في الساعة تكفي لما يُنبَّه به مرة في اليوم */
const DRIFT_EVERY_MS = 3_600_000;
const DAY_MS = 86_400_000;
/**
 * دفعة القراءة، لا سقف التنبيه. المنبَّه عنه يبقى في الاستعلام حتى يُحسم، فكانت `take: 200` وحدها
 * تعيد أقدم مئتين في كل دورة — منبَّهاً عنها كلها — ولا يصل ما بعدها تنبيه أبداً (20 أكتوبر 2026)
 */
const BATCH = 200;

/** مرتجع لم يُسجَّل استلامه بعدها عالق — صفحة المرتجعات في اللوحة تعلّمه بالعتبة نفسها (STALL_MS) */
export const RETURN_STALL_DAYS = 3;

/** نزاع مصعَّد بلا ردّ من الإدارة بعدها يُذكَّر به كل يوم — بطلب صاحبة المشروع (28 أكتوبر 2026) */
export const DISPUTE_WAIT_DAYS = 2;

/** سبب النزاع بالعربي — كما في إشعار التصعيد */
export const DISPUTE_REASON_AR: Readonly<Record<string, string>> = {
  not_received: 'لم يصلني الطلب',
  damaged: 'وصل تالفاً',
  not_as_described: 'لا يطابق الوصف',
  return_refused: 'رُفض إرجاعي',
  refund_missing: 'لم يصلني الاسترداد',
  other: 'مشكلة أخرى',
};

/** اسم كل فحص كما تعرضه لوحة الإدارة (admin/page.tsx VIEW_LABELS) */
export const DRIFT_LABELS: Readonly<Record<string, string>> = {
  audit_money_conservation: 'حفظ المال (بائع + منصة + مُسترد ≠ مقبوض)',
  audit_wallet_drift: 'رصيد محفظة لا يطابق دفترها',
  audit_withdrawn_drift: 'المسحوب لا يطابق قيود السحب',
  audit_sub_order_without_ledger: 'طلب مدفوع بلا قيد بيع',
  audit_inventory_drift: 'مخزون لا يطابق حركاته',
  audit_reservation_drift: 'محجوز لا يطابق الحجوزات',
  audit_order_split_drift: 'مجموع الفرعيات لا يساوي الأب',
  audit_paid_without_split: 'مدفوع بلا طلبات فرعية',
};

/**
 * تنبيهات الإدارة بما يتأخّر — 19 أكتوبر 2026. ما يقع في لحظته (متجر يُرسل طلبه، تحويل
 * ينتظر، سحب، تصعيد) يُبلَّغ من مكانه؛ وهذه حالات لا لحظة لها، تصير متأخّرة مع الوقت:
 *
 *   · مرتجع لم يستلمه المتجر بعد 3 أيام — المشتري ينتظر، ومال المتجر لا يُحرَّر
 *   · طلب لم يُقبل وبقي على إلغائه الآلي أقل من 12 ساعة
 *   · نزاع مصعَّد لم تردّ عليه الإدارة يومين — مرة في اليوم حتى تردّ أو تحسم
 *   · انحراف في منظرات التدقيق — مرة في اليوم لكل منظر ما دام قائماً
 *
 * كل حالة تُنبَّه مرة (alertAdminsOnce بمفتاحها)، لمن يحمل صلاحية التصرّف فيها وحده.
 */
@Injectable()
export class AdminAlertsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AdminAlerts');
  private stop: (() => void) | null = null;
  private running = false;
  private lastDriftAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.stop = everyAfterBoot(() => void this.tick(), EVERY_TEN_MINUTES);
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.stalledReturns(now);
      await this.acceptanceDue(now);
      await this.waitingDisputes(now);
      if (now.getTime() - this.lastDriftAt >= DRIFT_EVERY_MS) {
        this.lastDriftAt = now.getTime();
        await this.auditDrift(now);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`فشل تنبيه الإدارة: ${e.message}`, e.stack);
      writeErrorLog({
        timestamp: new Date().toISOString(),
        requestId: 'scheduler:admin-alerts',
        level: 'error',
        message: e.message,
        ...(e.stack ? { stack: e.stack } : {}),
      });
    } finally {
      this.running = false;
    }
  }

  /** مرتجع طُلب قبل 3 أيام ولم يُسجَّل استلامه — لمن يدير الطلبات (يسجّل الاستلام بدل المتجر) */
  async stalledReturns(now: Date, batch = BATCH): Promise<number> {
    let sent = 0;
    for (let cursor: string | undefined; ; ) {
      const rows = await this.prisma.returnRequest.findMany({
        where: { status: 'requested', requestedAt: { lt: new Date(now.getTime() - RETURN_STALL_DAYS * DAY_MS) } },
        select: { id: true, requestedAt: true, subOrder: { select: { subOrderNumber: true, vendor: { select: { nameAr: true } } } } },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
        take: batch,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const r of rows) {
        const ok = await this.notifications.alertAdminsOnce(`return_stalled:${r.id}`, {
          code: 'admin_return_stalled',
          permission: 'orders.manage',
          vars: {
            order_number: r.subOrder.subOrderNumber,
            store_name: r.subOrder.vendor.nameAr,
            days: String(Math.floor((now.getTime() - r.requestedAt.getTime()) / DAY_MS)),
            link: '/admin/returns',
          },
        });
        if (ok) sent++;
      }
      if (rows.length < batch) return sent;
      cursor = rows[rows.length - 1]!.id;
    }
  }

  /** فرعي ينتظر البائع دخل آخر 12 ساعة قبل إلغائه الآلي — القاعدة نفسها التي تعدّ بها البطاقة */
  async acceptanceDue(now: Date, batch = BATCH): Promise<number> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } });
    const deadline = Number(setting?.valueJson) > 0 ? Number(setting?.valueJson) : 48;
    let sent = 0;
    for (let cursor: string | undefined; ; ) {
      const rows = await this.prisma.subOrder.findMany({
        where: {
          status: 'awaiting_vendor',
          // ما فاتت مهلته تلغيه مهمة الطلبات — لا تنبيه بما انتهى
          placedAt: { lt: acceptanceDueSince(deadline, now), gte: new Date(now.getTime() - deadline * 3_600_000) },
        },
        select: { id: true, placedAt: true, subOrderNumber: true, vendor: { select: { nameAr: true } } },
        orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
        take: batch,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const s of rows) {
        const left = Math.max(1, Math.ceil((acceptBy(s.placedAt, deadline).getTime() - now.getTime()) / 3_600_000));
        const ok = await this.notifications.alertAdminsOnce(`acceptance_due:${s.id}`, {
          code: 'admin_acceptance_due',
          permission: 'orders.manage',
          vars: { order_number: s.subOrderNumber, store_name: s.vendor.nameAr, hours: String(left), link: '/admin/orders?due=acceptance' },
        });
        if (ok) sent++;
      }
      if (rows.length < batch) return sent;
      cursor = rows[rows.length - 1]!.id;
    }
  }

  /**
   * نزاع مصعَّد آخر كلمة فيه ليست للإدارة، ومضى يومان على تصعيده أو على آخر ردّ منها — لمن
   * يحسم النزاعات، مرة في اليوم ما دام كذلك. كان المصعَّد يُبلَّغ مرة لحظة تصعيده، ثم لا شيء:
   * من فاته الإشعار لا يعرف أن مشترياً ينتظر ومال متجر مجمَّد (بطلب صاحبة المشروع، 28 أكتوبر 2026).
   * وقت التصعيد من سجل التدقيق؛ ما فُتح مصعَّداً (لم يصلني الاسترداد) فمن فتحه.
   */
  async waitingDisputes(now: Date, batch = BATCH): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    let sent = 0;
    for (let cursor: string | undefined; ; ) {
      const rows = await this.prisma.dispute.findMany({
        where: { status: 'escalated' },
        select: {
          id: true,
          reasonCode: true,
          createdAt: true,
          messages: { orderBy: { createdAt: 'desc' }, select: { senderRole: true, createdAt: true } },
          subOrder: { select: { subOrderNumber: true, vendor: { select: { nameAr: true } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batch,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const escalations = await this.prisma.auditLog.findMany({
        where: { action: 'dispute.escalate', entityId: { in: rows.map((r) => r.id) } },
        select: { entityId: true, createdAt: true },
      });
      for (const d of rows) {
        // الإدارة آخر من كتب: الكرة عند غيرها
        if (d.messages[0]?.senderRole === 'admin') continue;
        const lastAdmin = d.messages.find((m) => m.senderRole === 'admin')?.createdAt;
        const escalatedAt = escalations.filter((e) => e.entityId === d.id).reduce((t, e) => (e.createdAt > t ? e.createdAt : t), d.createdAt);
        const since = lastAdmin && lastAdmin > escalatedAt ? lastAdmin : escalatedAt;
        const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
        if (days < DISPUTE_WAIT_DAYS) continue;
        const ok = await this.notifications.alertAdminsOnce(`dispute_waiting:${d.id}:${day}`, {
          code: 'admin_dispute_waiting',
          permission: 'disputes.resolve',
          vars: {
            order_number: d.subOrder.subOrderNumber,
            store_name: d.subOrder.vendor.nameAr,
            reason: DISPUTE_REASON_AR[d.reasonCode] ?? d.reasonCode,
            days: String(days),
            link: '/admin/disputes',
          },
        });
        if (ok) sent++;
      }
      if (rows.length < batch) return sent;
      cursor = rows[rows.length - 1]!.id;
    }
  }

  /** منظر تدقيق فيه صفوف — مرة في اليوم لكل منظر ما دام الانحراف قائماً، لمن يرى التقارير */
  async auditDrift(now: Date): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    let sent = 0;
    for (const d of await this.reports.drift()) {
      if (d.rows === 0) continue;
      const ok = await this.notifications.alertAdminsOnce(`audit_drift:${d.view}:${day}`, {
        code: 'admin_audit_drift',
        permission: 'reports.view',
        vars: { check: DRIFT_LABELS[d.view] ?? d.view, rows: String(d.rows), link: '/admin' },
      });
      if (ok) sent++;
    }
    return sent;
  }
}
