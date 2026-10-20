import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/security/actor';
import { AuditService } from '../../identity/public';
import { NotificationsService } from '../../notifications/public';
import { VendorEvents } from './vendor-events';
import {
  assertTransition,
  DOCUMENT_LABELS,
  isDocumentType,
  type VendorLifecycle,
} from '../domain/onboarding';

export interface ReviewQueueItem {
  readonly id: string;
  readonly nameAr: string;
  readonly slug: string;
  readonly country: string;
  readonly businessType: string | null;
  readonly status: VendorLifecycle;
  readonly submittedAt: string | null;
  /** كم انتظر البائع — الطابور يُقرأ بالأقدم أولاً */
  readonly waitingHours: number | null;
  readonly documentsAccepted: number;
  readonly documentsTotal: number;
}

/**
 * مراجعة طلبات البائعين — AD-04 و AD-05.
 *
 * قرار الرفض هنا **يعود بالطلب مسوّدة قابلة للإصلاح** لا يغلقه: البائع يرى
 * السبب كما كُتب، ويصلح، ويرسل ثانيةً. ولذلك يُشترط سبب غير فارغ في المخطط
 * نفسه لا في المتحكّم وحده.
 */
@Injectable()
export class VendorReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: VendorEvents,
  ) {}

  async queue(query: { status?: string; limit?: number; offset?: number; search?: string } = {}): Promise<{
    items: readonly ReviewQueueItem[];
    total: number;
  }> {
    const status = (query.status ?? 'in_review') as VendorLifecycle;
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = Math.max(query.offset ?? 0, 0);
    /**
     * بحث داخل الحالة: الاسم بالعربية أو الإنجليزية، أو الرابط، أو بريد صاحبه. كانت الصفحة
     * تعرض أول مئة بالأقدم ولا شيء بعدها — متجر «غزة» بين 5221 معتمداً لا يُوصل إليه (J-11)
     */
    const t = query.search?.trim();
    const where: Prisma.VendorWhereInput = {
      status: status as never,
      ...(t
        ? {
            OR: [
              { nameAr: { contains: t, mode: 'insensitive' } },
              { nameEn: { contains: t, mode: 'insensitive' } },
              { slug: { contains: t, mode: 'insensitive' } },
              { owner: { email: { contains: t, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.vendor.findMany({
        where,
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        take,
        skip,
        select: {
          id: true,
          nameAr: true,
          slug: true,
          country: true,
          businessType: true,
          status: true,
          submittedAt: true,
          documents: { select: { status: true } },
        },
      }),
      this.prisma.vendor.count({ where }),
    ]);

    const now = Date.now();
    return {
      total,
      items: rows.map((v) => ({
        id: v.id,
        nameAr: v.nameAr,
        slug: v.slug,
        country: v.country,
        businessType: v.businessType,
        status: v.status as VendorLifecycle,
        submittedAt: v.submittedAt?.toISOString() ?? null,
        waitingHours: v.submittedAt
          ? Math.floor((now - v.submittedAt.getTime()) / 3_600_000)
          : null,
        documentsAccepted: v.documents.filter((d) => d.status === 'accepted').length,
        documentsTotal: v.documents.length,
      })),
    };
  }

  /** قرار على وثيقة بعينها: يظهر للبائع بجانب بطاقتها في VD-02. */
  async decideDocument(
    actor: Actor,
    documentId: string,
    decision: { accept: boolean; reason?: string | null },
  ): Promise<void> {
    const doc = await this.prisma.vendorDocument.findUnique({
      where: { id: documentId },
      select: { id: true, vendorId: true, type: true },
    });
    if (!doc) throw new NotFoundError('الوثيقة غير موجودة.', { documentId });
    if (!isDocumentType(doc.type)) throw new InvalidInputError('نوع وثيقة غير معروف.');

    const reason = decision.reason?.trim() ?? '';
    if (!decision.accept && reason.length < 5) {
      throw new InvalidInputError(
        `سبب رفض ${DOCUMENT_LABELS[doc.type]} يُكتب للبائع — لا يُترك فارغاً.`,
      );
    }

    await this.prisma.vendorDocument.update({
      where: { id: documentId },
      data: {
        status: decision.accept ? 'accepted' : 'rejected',
        rejectReason: decision.accept ? null : reason,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: 'admin',
      action: decision.accept ? 'vendor.document.accept' : 'vendor.document.reject',
      entityType: 'VendorDocument',
      entityId: documentId,
      after: { vendorId: doc.vendorId, type: doc.type, reason: decision.accept ? null : reason },
    });
  }

  async approve(actor: Actor, vendorId: string): Promise<void> {
    const vendor = await this.require(vendorId);
    assertTransition(vendor.status as VendorLifecycle, 'approved');

    /**
     * الشرط على الحالة داخل الكتابة نفسها: مراجعان يضغطان «اعتماد» معاً
     * لا ينتج عنهما اعتمادان، والثاني يسمع «تغيّرت الحالة».
     */
    const { count } = await this.prisma.vendor.updateMany({
      where: { id: vendorId, status: 'in_review' },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: actor.userId,
        // الاعتماد يثبّت العملة (ADR-013): بعده تُسعَّر المنتجات والشحن وتُفتح المحفظة بها
        settlementCurrencyLockedAt: vendor.settlementCurrencyLockedAt ?? new Date(),
        rejectionReason: null,
        rejectedAt: null,
      },
    });
    if (count === 0) {
      throw new ConflictError('تغيّرت حالة الطلب. حدّث الصفحة.', { vendorId });
    }

    // الوثائق المقبولة ضمناً باعتماد المتجر — فلا تبقى «قيد المراجعة» إلى الأبد
    await this.prisma.vendorDocument.updateMany({
      where: { vendorId, status: 'pending' },
      data: { status: 'accepted', reviewedBy: actor.userId, reviewedAt: new Date() },
    });

    // حساب التسجيل البنكي وثّقته المراجعة نفسها (وثيقة bank_proof) — بعد
    // الاعتماد لا يصير حساب افتراضياً إلا موثَّقاً (VD-20)
    await this.prisma.vendorBankAccount.updateMany({
      where: { vendorId, archivedAt: null, verifiedAt: null },
      data: { verifiedAt: new Date(), verifiedBy: actor.userId },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: 'admin',
      action: 'vendor.approve',
      entityType: 'Vendor',
      entityId: vendorId,
    });
    await this.events.visibilityChanged(vendorId);
    await this.notifications.enqueueVendor({ code: 'vendor_approved', vendorId, vars: { link: '/vendor' } });
  }

  async reject(actor: Actor, vendorId: string, reason: string): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      throw new InvalidInputError(
        'سبب الرفض يُقرأ من البائع كما هو — اكتبه واضحاً (10 أحرف على الأقل).',
      );
    }
    const vendor = await this.require(vendorId);
    assertTransition(vendor.status as VendorLifecycle, 'rejected');

    const { count } = await this.prisma.vendor.updateMany({
      where: { id: vendorId, status: 'in_review' },
      data: {
        status: 'rejected',
        rejectionReason: trimmed,
        rejectedAt: new Date(),
        submittedAt: null,
      },
    });
    if (count === 0) {
      throw new ConflictError('تغيّرت حالة الطلب. حدّث الصفحة.', { vendorId });
    }

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: 'admin',
      action: 'vendor.reject',
      entityType: 'Vendor',
      entityId: vendorId,
      after: { reason: trimmed },
    });
    await this.notifications.enqueueVendor({
      code: 'vendor_rejected',
      vendorId,
      vars: { reason: trimmed, link: '/vendor/onboarding/status' },
    });
  }

  /**
   * التعليق يوقف البيع فوراً: النشر يُرفض، والمنتجات المنشورة تختفي من المتجر
   * لأن كل استعلام عام يشترط `canSell` على حالة البائع.
   */
  async suspend(actor: Actor, vendorId: string, reason: string): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length < 10) throw new InvalidInputError('سبب التعليق مطلوب ويُسجَّل في التدقيق.');
    const vendor = await this.require(vendorId);
    assertTransition(vendor.status as VendorLifecycle, 'suspended');

    const { count } = await this.prisma.vendor.updateMany({
      where: { id: vendorId, status: 'approved' },
      data: { status: 'suspended', suspendedAt: new Date() },
    });
    if (count === 0) throw new ConflictError('تغيّرت حالة المتجر.', { vendorId });

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: 'admin',
      action: 'vendor.suspend',
      entityType: 'Vendor',
      entityId: vendorId,
      after: { reason: trimmed },
    });
    await this.events.visibilityChanged(vendorId);
  }

  async reinstate(actor: Actor, vendorId: string): Promise<void> {
    const vendor = await this.require(vendorId);
    assertTransition(vendor.status as VendorLifecycle, 'approved');

    const { count } = await this.prisma.vendor.updateMany({
      where: { id: vendorId, status: 'suspended' },
      data: {
        status: 'approved',
        suspendedAt: null,
        approvedAt: vendor.approvedAt ?? new Date(),
        approvedBy: vendor.approvedBy ?? actor.userId,
      },
    });
    if (count === 0) throw new ConflictError('تغيّرت حالة المتجر.', { vendorId });

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: 'admin',
      action: 'vendor.reinstate',
      entityType: 'Vendor',
      entityId: vendorId,
    });
    await this.events.visibilityChanged(vendorId);
  }

  private async require(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('المتجر غير موجود.', { vendorId });
    return vendor;
  }
}
