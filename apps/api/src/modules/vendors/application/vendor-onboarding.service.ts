import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  DuplicateError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor, VendorScope } from '../../../common/security/actor';
import { AuditService, AuthService, TokenService, type TokenPair } from '../../identity/public';
import { VendorDocumentStorage } from '../infrastructure/document-storage';
import {
  assertCurrencyChangeable,
  currencyLocked,
  assertDocumentFile,
  assertSettlementCurrency,
  assertSlug,
  assertTransition,
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  defaultCurrencyFor,
  isDocumentType,
  isValidIban,
  normalizeIban,
  submissionBlockers,
  suggestSlug,
  vendorSlug,
  type Blocker,
  type DocumentType,
  type VendorLifecycle,
} from '../domain/onboarding';

export interface OnboardingDocumentView {
  readonly type: DocumentType;
  readonly label: string;
  readonly uploaded: boolean;
  readonly status: 'missing' | 'pending' | 'accepted' | 'rejected';
  readonly rejectReason: string | null;
  readonly originalName: string | null;
  readonly sizeBytes: number | null;
  readonly uploadedAt: string | null;
  /** مسار تنزيل مصادَق — لا رابط عام */
  readonly downloadPath: string | null;
}

export interface OnboardingView {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly country: string;
  readonly businessType: string | null;
  readonly status: VendorLifecycle;
  readonly rejectionReason: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly settlementCurrency: string;
  readonly settlementCurrencyLocked: boolean;
  /** اختارها البائع صراحةً — وإلا فهي المقترحة من بلده، والإرسال ممنوع حتى يختار */
  readonly settlementCurrencyChosen: boolean;
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  readonly shippingPolicyAr: string | null;
  readonly returnPolicyAr: string | null;
  readonly documents: readonly OnboardingDocumentView[];
  readonly bank: { holderName: string; iban: string; bankName: string; swift: string | null } | null;
  readonly blockers: readonly Blocker[];
  readonly canSubmit: boolean;
}

const DOCUMENT_SELECT = {
  id: true,
  type: true,
  status: true,
  rejectReason: true,
  originalName: true,
  sizeBytes: true,
  createdAt: true,
} as const;

/**
 * رحلة البائع من التسجيل إلى الاعتماد.
 *
 * ترتيب الشاشات في التصميم (VD-01 → VD-05) ليس ترتيباً إجبارياً في الخادم:
 * البائع قد يرفع وثيقة ثم يعود ليصحّح اسم متجره. الخادم يحرس **شرط الإرسال**
 * لا ترتيب الخطوات — والموانع تُحسب مجتمعة في كل قراءة.
 */
@Injectable()
export class VendorOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VendorDocumentStorage,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  // ----------------------------------------------------------- التسجيل

  /**
   * إنشاء متجر للمستخدم الحالي ومنحه دور `vendor_owner`.
   * الاثنان في معاملة واحدة: متجر بلا دور يعني صاحباً لا يصل إلى متجره،
   * ودور بلا متجر يعني رمز وصول يحمل صلاحية على لا شيء.
   */
  async apply(
    actor: Actor,
    input: {
      nameAr: string;
      nameEn?: string | null;
      slug?: string | null;
      country: string;
      businessType?: string | null;
      /** اختيار صريح من البائع — بدونه تُقترح عملة بلده ويُطلب اختيارها قبل الإرسال */
      settlementCurrency?: string | null;
    },
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<{ vendor: OnboardingView; tokens: TokenPair }> {
    const existing = await this.prisma.vendor.findFirst({
      where: { ownerUserId: actor.userId },
      select: { id: true },
    });
    if (existing) {
      throw new DuplicateError('لديك متجر مسجَّل بالفعل.', { vendorId: existing.id });
    }

    const nameAr = input.nameAr.trim();
    if (nameAr.length < 2) throw new InvalidInputError('اسم المتجر بالعربية مطلوب.');

    const country = input.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new InvalidInputError('بلد المتجر يُكتب برمز من حرفين (SA، JO، AE…).', { country });
    }

    const slug = await this.resolveSlug(input.slug ?? vendorSlug(input.nameEn?.trim() || nameAr));

    if (input.businessType && !['individual', 'company'].includes(input.businessType)) {
      throw new InvalidInputError('نوع النشاط: فرد أو شركة.', { businessType: input.businessType });
    }

    const chosen = input.settlementCurrency?.trim().toUpperCase() || null;
    if (chosen) assertSettlementCurrency(chosen);

    const vendorId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.vendor.create({
        data: {
          id: vendorId,
          ownerUserId: actor.userId,
          slug,
          nameAr,
          nameEn: input.nameEn?.trim() || null,
          country,
          businessType: input.businessType ?? null,
          settlementCurrency: chosen ?? defaultCurrencyFor(country),
          settlementCurrencyChosenAt: chosen ? new Date() : null,
          status: 'pending',
        },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId: actor.userId, role: 'vendor_owner' } },
        update: {},
        create: { userId: actor.userId, role: 'vendor_owner' },
      });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: 'vendor_owner',
      action: 'vendor.apply',
      entityType: 'Vendor',
      entityId: vendorId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    /**
     * رمز جديد فوراً: الرمز الحالي صدر لعميل لا يملك متجراً، فلا يحمل
     * معرّف المتجر ولا دور البائع — وبدونه ترتدّ كل خطوة تالية في التأهيل 403.
     */
    const claims = await this.auth.buildClaims(actor.userId);
    const tokens = await this.tokens.issue(claims, {
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      ...(meta.ip ? { ip: meta.ip } : {}),
    });

    return { vendor: await this.view(vendorId), tokens };
  }

  /** فحص توفّر الرابط أثناء الكتابة — VD-01 يعرض بديلاً بدل رفض جاف */
  async checkSlug(candidate: string): Promise<{ slug: string; available: boolean; suggestion: string }> {
    const slug = vendorSlug(candidate);
    assertSlug(slug);
    const taken = await this.takenSlugs(slug);
    return {
      slug,
      available: !taken.has(slug),
      suggestion: suggestSlug(slug, taken),
    };
  }

  private async resolveSlug(candidate: string): Promise<string> {
    const slug = vendorSlug(candidate);
    assertSlug(slug);
    const taken = await this.takenSlugs(slug);
    if (taken.has(slug)) {
      throw new DuplicateError('رابط المتجر مستعمَل. جرّب البديل المقترح.', {
        slug,
        suggestion: suggestSlug(slug, taken),
      });
    }
    return slug;
  }

  private async takenSlugs(base: string): Promise<Set<string>> {
    const rows = await this.prisma.vendor.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    return new Set(rows.map((r) => r.slug));
  }

  // ------------------------------------------------------------- القراءة

  async mine(actor: Actor): Promise<OnboardingView> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { ownerUserId: actor.userId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundError('لا متجر مسجَّل على حسابك.');
    return this.view(vendor.id);
  }

  async view(vendorId: string): Promise<OnboardingView> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        documents: { select: DOCUMENT_SELECT },
        bankAccounts: { where: { isDefault: true }, take: 1 },
      },
    });
    if (!vendor) throw new NotFoundError('المتجر غير موجود.', { vendorId });

    const bank = vendor.bankAccounts[0] ?? null;
    const blockers = submissionBlockers({
      nameAr: vendor.nameAr,
      slug: vendor.slug,
      country: vendor.country,
      currencyChosen: vendor.settlementCurrencyChosenAt !== null,
      documents: vendor.documents.map((d) => ({
        type: d.type,
        status: d.status,
        rejectReason: d.rejectReason,
      })),
      bank: bank ? { iban: bank.iban, holderName: bank.holderName } : null,
    });

    const documents: OnboardingDocumentView[] = DOCUMENT_TYPES.map((type) => {
      const doc = vendor.documents.find((d) => d.type === type);
      return {
        type,
        label: DOCUMENT_LABELS[type],
        uploaded: Boolean(doc),
        status: (doc?.status as 'pending' | 'accepted' | 'rejected' | undefined) ?? 'missing',
        rejectReason: doc?.rejectReason ?? null,
        originalName: doc?.originalName ?? null,
        sizeBytes: doc?.sizeBytes ?? null,
        uploadedAt: doc?.createdAt.toISOString() ?? null,
        downloadPath: doc ? `/vendor/onboarding/documents/${doc.id}` : null,
      };
    });

    const status = vendor.status as VendorLifecycle;
    return {
      id: vendor.id,
      slug: vendor.slug,
      nameAr: vendor.nameAr,
      nameEn: vendor.nameEn,
      country: vendor.country,
      businessType: vendor.businessType,
      status,
      rejectionReason: vendor.rejectionReason,
      submittedAt: vendor.submittedAt?.toISOString() ?? null,
      approvedAt: vendor.approvedAt?.toISOString() ?? null,
      settlementCurrency: vendor.settlementCurrency,
      settlementCurrencyLocked: currencyLocked(vendor.settlementCurrencyLockedAt, vendor.status as VendorLifecycle),
      settlementCurrencyChosen: vendor.settlementCurrencyChosenAt !== null,
      descriptionAr: vendor.descriptionAr,
      descriptionEn: vendor.descriptionEn,
      shippingPolicyAr: vendor.shippingPolicyAr,
      returnPolicyAr: vendor.returnPolicyAr,
      documents,
      bank: bank
        ? { holderName: bank.holderName, iban: bank.iban, bankName: bank.bankName, swift: bank.swift }
        : null,
      blockers,
      canSubmit: blockers.length === 0 && (status === 'pending' || status === 'rejected'),
    };
  }

  // ------------------------------------------------------------ التعديل

  /** بيانات المتجر الأساسية تُعدَّل في المسوّدة والطلب المرفوض وحدهما. */
  async updateShop(
    scope: VendorScope,
    input: {
      nameAr?: string;
      nameEn?: string | null;
      slug?: string;
      country?: string;
      businessType?: string | null;
    },
  ): Promise<OnboardingView> {
    const vendor = await this.require(scope.vendorId);
    this.assertEditable(vendor.status as VendorLifecycle);

    const data: Record<string, unknown> = {};
    if (input.nameAr !== undefined) {
      const nameAr = input.nameAr.trim();
      if (nameAr.length < 2) throw new InvalidInputError('اسم المتجر بالعربية مطلوب.');
      data['nameAr'] = nameAr;
    }
    if (input.nameEn !== undefined) data['nameEn'] = input.nameEn?.trim() || null;
    if (input.slug !== undefined && input.slug !== vendor.slug) {
      data['slug'] = await this.resolveSlug(input.slug);
    }
    if (input.country !== undefined) {
      const country = input.country.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw new InvalidInputError('بلد المتجر يُكتب برمز من حرفين.');
      data['country'] = country;
    }
    if (input.businessType !== undefined) {
      if (input.businessType && !['individual', 'company'].includes(input.businessType)) {
        throw new InvalidInputError('نوع النشاط: فرد أو شركة.');
      }
      data['businessType'] = input.businessType ?? null;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.vendor.update({ where: { id: scope.vendorId }, data });
    }
    return this.view(scope.vendorId);
  }

  /** ملف المتجر — VD-05. متاح بعد الاعتماد أيضاً: الوصف والسياسات محتوى حيّ. */
  async updateProfile(
    scope: VendorScope,
    input: {
      descriptionAr?: string | null;
      descriptionEn?: string | null;
      shippingPolicyAr?: string | null;
      returnPolicyAr?: string | null;
    },
  ): Promise<OnboardingView> {
    await this.require(scope.vendorId);
    const trim = (v: string | null | undefined): string | null => v?.trim() || null;

    const data: Record<string, string | null> = {};
    if (input.descriptionAr !== undefined) data['descriptionAr'] = trim(input.descriptionAr);
    if (input.descriptionEn !== undefined) data['descriptionEn'] = trim(input.descriptionEn);
    if (input.shippingPolicyAr !== undefined) data['shippingPolicyAr'] = trim(input.shippingPolicyAr);
    if (input.returnPolicyAr !== undefined) data['returnPolicyAr'] = trim(input.returnPolicyAr);
    if (Object.keys(data).length > 0) {
      await this.prisma.vendor.update({ where: { id: scope.vendorId }, data });
    }
    return this.view(scope.vendorId);
  }

  // ------------------------------------------------------------ الوثائق

  async uploadDocument(
    scope: VendorScope,
    type: string,
    file: Buffer,
    originalName: string | null,
  ): Promise<OnboardingView> {
    const vendor = await this.require(scope.vendorId);
    this.assertEditable(vendor.status as VendorLifecycle);
    if (!isDocumentType(type)) {
      throw new InvalidInputError(`نوع وثيقة غير معروف: ${type}.`, { type });
    }

    const mimeType = assertDocumentFile(file);
    const key = `${scope.vendorId}/${type}/${randomUUID()}`;
    await this.storage.save(key, file);

    const previous = await this.prisma.vendorDocument.findUnique({
      where: { vendorId_type: { vendorId: scope.vendorId, type } },
      select: { fileKey: true },
    });

    try {
      await this.prisma.vendorDocument.upsert({
        where: { vendorId_type: { vendorId: scope.vendorId, type } },
        create: {
          vendorId: scope.vendorId,
          type,
          fileKey: key,
          mimeType,
          sizeBytes: file.length,
          originalName: originalName?.slice(0, 200) ?? null,
          status: 'pending',
        },
        update: {
          fileKey: key,
          mimeType,
          sizeBytes: file.length,
          originalName: originalName?.slice(0, 200) ?? null,
          // إعادة الرفع تمسح الرفض: المراجع يرى وثيقة جديدة لا وثيقة مرفوضة بملف جديد
          status: 'pending',
          rejectReason: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      });
    } catch (err) {
      await this.storage.remove(key);
      throw err;
    }

    // الملف القديم يُحذف بعد نجاح الكتابة لا قبلها
    if (previous && previous.fileKey !== key) {
      await this.storage.remove(previous.fileKey).catch(() => undefined);
    }

    return this.view(scope.vendorId);
  }

  /**
   * تنزيل وثيقة. لا رابط عام: الملكية تُفحص هنا، والإدارة تُستثنى صراحةً
   * لأن مراجعة الطلب تتطلب فتح الوثيقة.
   */
  async readDocument(
    scope: VendorScope,
    documentId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const doc = await this.prisma.vendorDocument.findFirst({
      where: { id: documentId, vendorId: scope.vendorId },
      select: { fileKey: true, mimeType: true, originalName: true, type: true },
    });
    if (!doc) throw new NotFoundError('الوثيقة غير موجودة.', { documentId });

    const buffer = await this.storage.read(doc.fileKey);
    const extension = doc.mimeType === 'application/pdf' ? 'pdf' : doc.mimeType.split('/')[1];
    return {
      buffer,
      mimeType: doc.mimeType,
      fileName: doc.originalName ?? `${doc.type}.${extension}`,
    };
  }

  // -------------------------------------------------------- الحساب البنكي

  async saveBank(
    scope: VendorScope,
    input: { holderName: string; iban: string; bankName: string; swift?: string | null },
  ): Promise<OnboardingView> {
    const vendor = await this.require(scope.vendorId);
    this.assertEditable(vendor.status as VendorLifecycle);

    const iban = normalizeIban(input.iban);
    const holderName = input.holderName.trim();
    const bankName = input.bankName.trim();
    if (holderName.length < 3) throw new InvalidInputError('اسم صاحب الحساب كما هو لدى البنك.');
    if (bankName.length < 2) throw new InvalidInputError('اسم البنك مطلوب.');
    // الفحص هنا بمجموع mod-97 لا بالشكل: رقم بخانة مقلوبة يمرّ الشكل
    // ثم يسقط في البنك بعد أسبوعين من البيع — والبائع لا يعرف لماذا.
    if (!isValidIban(iban)) {
      throw new InvalidInputError('رقم الآيبان غير صحيح. راجعه كما هو مكتوب في كشف حسابك.', { iban });
    }

    const current = await this.prisma.vendorBankAccount.findFirst({
      where: { vendorId: scope.vendorId, isDefault: true },
      select: { id: true },
    });

    if (current) {
      await this.prisma.vendorBankAccount.update({
        where: { id: current.id },
        data: { holderName, iban, bankName, swift: input.swift?.trim() || null, verifiedAt: null },
      });
    } else {
      await this.prisma.vendorBankAccount.create({
        data: {
          vendorId: scope.vendorId,
          holderName,
          iban,
          bankName,
          swift: input.swift?.trim() || null,
          isDefault: true,
        },
      });
    }
    return this.view(scope.vendorId);
  }

  // ------------------------------------------------------ عملة التسوية

  async setSettlementCurrency(
    scope: VendorScope,
    currency: string,
    options: { lock?: boolean } = {},
  ): Promise<OnboardingView> {
    const vendor = await this.require(scope.vendorId);
    const code = currency.trim().toUpperCase();
    assertSettlementCurrency(code);
    const [variants, rates, orders] = await Promise.all([
      this.prisma.productVariant.count({ where: { vendorId: scope.vendorId } }),
      this.prisma.shippingRate.count({ where: { zone: { vendorId: scope.vendorId } } }),
      this.prisma.subOrder.count({ where: { vendorId: scope.vendorId } }),
    ]);
    // العملة نفسها لا تغيّر معنى سعر — التثبيت وحده مسموح ولو وُجد المسعَّر
    const changing = code !== vendor.settlementCurrency;
    assertCurrencyChangeable({
      lockedAt: vendor.settlementCurrencyLockedAt,
      status: vendor.status as VendorLifecycle,
      priced: changing && variants + rates + orders > 0,
    });

    // الشروط نفسها داخل الكتابة: اعتماد أو تثبيت متزامن لا يمرّ معه تغيير.
    // والإرسال بالعملة نفسها اختيار أيضاً: من أكّد المقترحة اختارها
    const { count } = await this.prisma.vendor.updateMany({
      where: { id: scope.vendorId, settlementCurrencyLockedAt: null, status: { in: ['pending', 'rejected'] } },
      data: {
        settlementCurrency: code,
        settlementCurrencyChosenAt: new Date(),
        ...(options.lock ? { settlementCurrencyLockedAt: new Date() } : {}),
      },
    });
    if (count === 0) throw new ConflictError('تغيّرت حالة المتجر أو عملته. حدّث الصفحة.', { vendorId: scope.vendorId });
    return this.view(scope.vendorId);
  }

  // --------------------------------------------------------- الإرسال

  /**
   * الإرسال للمراجعة. الشرط الوحيد هو خلوّ قائمة الموانع — وهي القائمة نفسها
   * التي تعرضها الشاشة، فلا يرى البائع «أرسل» مفعّلاً ثم يُرفض طلبه.
   */
  async submit(scope: VendorScope, meta: { ip?: string | null } = {}): Promise<OnboardingView> {
    const vendor = await this.require(scope.vendorId);
    const status = vendor.status as VendorLifecycle;
    assertTransition(status, 'in_review');

    const view = await this.view(scope.vendorId);
    if (view.blockers.length > 0) {
      throw new ConflictError(
        'أكمل النواقص قبل إرسال الطلب للمراجعة.',
        { blockers: view.blockers.map((b) => b.code) },
      );
    }

    await this.prisma.vendor.update({
      where: { id: scope.vendorId },
      data: {
        status: 'in_review',
        submittedAt: new Date(),
        rejectionReason: null,
        rejectedAt: null,
      },
    });

    await this.audit.record({
      actorUserId: vendor.ownerUserId,
      actorRole: 'vendor_owner',
      action: 'vendor.submit',
      entityType: 'Vendor',
      entityId: scope.vendorId,
      ip: meta.ip ?? null,
      userAgent: null,
    });

    return this.view(scope.vendorId);
  }

  // ----------------------------------------------------------- مساعدات

  private async require(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('المتجر غير موجود.', { vendorId });
    return vendor;
  }

  /**
   * بيانات التسجيل تُعدَّل في المسوّدة والطلب المرفوض **وحدهما**. ما يُرسَل
   * للمراجعة يُجمَّد: تعديله بعدها يعني مراجعة على بيانات غير التي قُرئت.
   *
   * والمعتمد أشدّ: كان يمرّ من هنا بلا مراجعة ولا إعادة مصادقة ولا تدقيق ولا
   * إشعار — فيبدّل اسم المتجر، ويستبدل وثائق KYC (وتُحذف المقبولة)، ويكتب
   * آيبان جديداً فوق الافتراضي الذي تُحوَّل إليه الأرباح. بعد الاعتماد:
   * الحساب البنكي من الإعدادات (إعادة مصادقة، وتوثيق من الإدارة، وتنبيه
   * فوري)، واسم المتجر ووثائقه من الدعم.
   */
  private assertEditable(status: VendorLifecycle): void {
    if (status === 'pending' || status === 'rejected') return;
    if (status === 'in_review') {
      throw new ConflictError(
        'طلبك قيد المراجعة الآن ولا يقبل التعديل. انتظر النتيجة أو راسل الدعم.',
        { status },
      );
    }
    if (status === 'approved') {
      throw new ConflictError(
        'متجرك معتمد: اسمه ورابطه ووثائقه مثبّتة كما رُوجعت، ولتغييرها راسل الدعم. الحساب البنكي يُضاف من الإعدادات.',
        { status },
      );
    }
    throw new ConflictError('حساب المتجر موقوف. راسل الدعم.', { status });
  }
}
