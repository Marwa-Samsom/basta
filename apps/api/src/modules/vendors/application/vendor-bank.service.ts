import { Injectable } from '@nestjs/common';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor, VendorScope } from '../../../common/security/actor';
import { AuthService } from '../../identity/public';
import { NotificationsService } from '../../notifications/public';
import { isValidIban, normalizeIban } from '../domain/onboarding';

/** سقف معقول: متجر بخمسة حسابات حيّة حالة نادرة، وبعشرين علامة عبث */
export const MAX_BANK_ACCOUNTS = 5;

export interface BankAccountView {
  id: string;
  bankName: string;
  holderName: string;
  /** للبائع: أول أربعة وآخر أربعة فقط — الشاشة تُعرض أمام موظفين وكاميرات */
  ibanMasked: string;
  ibanTail: string;
  swift: string | null;
  isDefault: boolean;
  verified: boolean;
  createdAt: Date;
}

const NOT_FOUND = 'الحساب البنكي غير موجود. حدّث الصفحة.';
const LINK = '/vendor/settings?tab=banks';

const tail = (iban: string) => iban.slice(-4);
const mask = (iban: string) => `${iban.slice(0, 4)} •••• •••• ${tail(iban)}`;

type Row = {
  id: string;
  bankName: string;
  holderName: string;
  iban: string;
  swift: string | null;
  isDefault: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
};

const view = (b: Row): BankAccountView => ({
  id: b.id,
  bankName: b.bankName,
  holderName: b.holderName,
  ibanMasked: mask(b.iban),
  ibanTail: tail(b.iban),
  swift: b.swift,
  isDefault: b.isDefault,
  verified: b.verifiedAt !== null,
  createdAt: b.createdAt,
});

/**
 * حسابات البائع البنكية بعد الاعتماد — VD-20.
 *
 * التهديد الذي يشكّل كل قرار هنا: من سرق جلسة بائع يريد أن يحوّل رصيده
 * إلى حسابه هو. لذلك:
 *   - الإضافة تطلب كلمة المرور (والإثبات الثاني إن كان مفعَّلاً) لا الجلسة وحدها؛
 *   - الحساب الجديد لا يصير افتراضياً — ولا يُحوَّل إليه شيء — قبل أن يوثّقه مدير؛
 *   - يصل صاحب المتجر بريد فوري بكل إضافة، والإطفاء من التفضيلات لا يشمله؛
 *   - الحساب لا يُحذف بل يُؤرشف: قد يكون وجهة تحويل سابق يُسأل عنه لاحقاً.
 *
 * أثناء التسجيل يبقى الحساب الواحد في `VendorOnboardingService.saveBank`.
 */
@Injectable()
export class VendorBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(scope: VendorScope): Promise<BankAccountView[]> {
    const rows = await this.prisma.vendorBankAccount.findMany({
      where: { vendorId: scope.vendorId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(view);
  }

  async add(
    scope: VendorScope,
    actor: Actor,
    input: { holderName: string; iban: string; bankName: string; swift?: string | null | undefined },
    proof: { password: string; code?: string | undefined },
    meta: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<BankAccountView> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: scope.vendorId }, select: { status: true, nameAr: true } });
    if (!vendor) throw new NotFoundError('المتجر غير موجود.');
    if (vendor.status !== 'approved' && vendor.status !== 'suspended') {
      throw new ConflictError('أثناء التسجيل يُعدَّل الحساب البنكي من خطوات التسجيل نفسها.');
    }

    const iban = normalizeIban(input.iban);
    const holderName = input.holderName.trim();
    const bankName = input.bankName.trim();
    if (holderName.length < 3) throw new InvalidInputError('اسم صاحب الحساب كما هو لدى البنك.');
    if (bankName.length < 2) throw new InvalidInputError('اسم البنك مطلوب.');
    if (!isValidIban(iban)) {
      throw new InvalidInputError('رقم الآيبان غير صحيح. راجعه كما هو مكتوب في كشف حسابك.', { iban });
    }

    // الإثبات قبل أي كتابة — وبعد فحوص الشكل كي لا يُحرق رمز TOTP على خطأ إملائي
    await this.auth.reauthenticate(actor.userId, proof, meta);

    return this.prisma.$transaction(async (tx) => {
      // قفل صف المتجر: إضافتان متزامنتان لا تتجاوزان السقف ولا تكرّران الآيبان
      await tx.$queryRaw`SELECT 1 FROM "vendors" WHERE "id" = ${scope.vendorId}::uuid FOR UPDATE`;
      const live = await tx.vendorBankAccount.findMany({
        where: { vendorId: scope.vendorId, archivedAt: null },
        select: { iban: true },
      });
      if (live.some((b) => b.iban === iban)) throw new ConflictError('هذا الحساب مضاف من قبل.');
      if (live.length >= MAX_BANK_ACCOUNTS) {
        throw new ConflictError(`الحدّ ${MAX_BANK_ACCOUNTS} حسابات. أرشف حساباً لا تستعمله أولاً.`);
      }

      const row = await tx.vendorBankAccount.create({
        data: {
          vendorId: scope.vendorId,
          holderName,
          iban,
          bankName,
          swift: input.swift?.trim() || null,
          isDefault: false,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: 'vendor_owner',
          action: 'vendor.bank_account_add',
          entityType: 'VendorBankAccount',
          entityId: row.id,
          afterJson: { vendorId: scope.vendorId, bankName, ibanTail: tail(iban) },
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
      await this.notifications.enqueueVendor(
        { code: 'bank_account_added', vendorId: scope.vendorId, vars: { bank: bankName, iban_tail: tail(iban), link: LINK } },
        tx,
      );
      // ومن يوثّق الحسابات يعرف: لا يُحوَّل إليه شيء قبل توثيقه، ولا قائمة تجمعها في اللوحة
      await this.notifications.enqueueAdmins(
        {
          code: 'admin_bank_account_added',
          permission: 'vendors.review',
          vars: { store_name: vendor.nameAr, bank_name: bankName, iban_tail: tail(iban), link: `/admin/vendors/${scope.vendorId}` },
        },
        tx,
      );
      return view(row);
    });
  }

  /** الافتراضي هو وجهة التحويلات — موثَّق وحيّ وحده يصلح */
  async setDefault(scope: VendorScope, actor: Actor, id: string): Promise<BankAccountView[]> {
    await this.prisma.$transaction(async (tx) => {
      // تبديلان متزامنان يتسلسلان هنا — وإلا رأى الثاني لقطة قديمة واصطدم بالفهرس الفريد
      await tx.$queryRaw`SELECT 1 FROM "vendors" WHERE "id" = ${scope.vendorId}::uuid FOR UPDATE`;
      const target = await tx.vendorBankAccount.findFirst({
        where: { id, vendorId: scope.vendorId, archivedAt: null },
        select: { id: true, verifiedAt: true, isDefault: true },
      });
      if (!target) throw new NotFoundError(NOT_FOUND);
      if (target.isDefault) return;
      if (!target.verifiedAt) throw new ConflictError('الحساب لم يُوثَّق بعد. يصير افتراضياً بعد أن يوثّقه فريق بسطة.');

      await tx.vendorBankAccount.updateMany({
        where: { vendorId: scope.vendorId, isDefault: true },
        data: { isDefault: false },
      });
      // الشرط في الكتابة نفسها: حساب أُرشف بين القراءة والكتابة لا يصير افتراضياً
      const { count } = await tx.vendorBankAccount.updateMany({
        where: { id, vendorId: scope.vendorId, archivedAt: null, verifiedAt: { not: null } },
        data: { isDefault: true },
      });
      if (count === 0) throw new ConflictError('تغيّر الحساب. حدّث الصفحة.');
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: 'vendor_owner',
          action: 'vendor.bank_account_default',
          entityType: 'VendorBankAccount',
          entityId: id,
          afterJson: { vendorId: scope.vendorId },
        },
      });
    });
    return this.list(scope);
  }

  async archive(scope: VendorScope, actor: Actor, id: string): Promise<BankAccountView[]> {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.vendorBankAccount.findFirst({
        where: { id, vendorId: scope.vendorId, archivedAt: null },
        select: { isDefault: true },
      });
      if (!target) throw new NotFoundError(NOT_FOUND);
      if (target.isDefault) throw new ConflictError('لا يُؤرشف الحساب الافتراضي. اجعل حساباً آخر افتراضياً أولاً.');
      const { count } = await tx.vendorBankAccount.updateMany({
        where: { id, vendorId: scope.vendorId, archivedAt: null, isDefault: false },
        data: { archivedAt: new Date() },
      });
      if (count === 0) throw new ConflictError('تغيّر الحساب. حدّث الصفحة.');
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: 'vendor_owner',
          action: 'vendor.bank_account_archive',
          entityType: 'VendorBankAccount',
          entityId: id,
          afterJson: { vendorId: scope.vendorId },
        },
      });
    });
    return this.list(scope);
  }

  // ------------------------------------------------------------- الإدارة

  /** للمراجع: الآيبان كاملاً ليطابقه مع إثبات البنك واسم النشاط */
  async listForAdmin(vendorId: string) {
    const rows = await this.prisma.vendorBankAccount.findMany({
      where: { vendorId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((b) => ({ ...view(b), iban: b.iban, verifiedAt: b.verifiedAt }));
  }

  async verify(actor: Actor, vendorId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.vendorBankAccount.updateMany({
        where: { id, vendorId, archivedAt: null, verifiedAt: null },
        data: { verifiedAt: new Date(), verifiedBy: actor.userId },
      });
      if (count === 0) {
        const exists = await tx.vendorBankAccount.count({ where: { id, vendorId, archivedAt: null } });
        if (!exists) throw new NotFoundError(NOT_FOUND);
        throw new ConflictError('الحساب موثَّق من قبل.');
      }
      const b = await tx.vendorBankAccount.findUniqueOrThrow({ where: { id }, select: { bankName: true, iban: true } });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorRole: 'admin',
          action: 'vendor.bank_account_verify',
          entityType: 'VendorBankAccount',
          entityId: id,
          afterJson: { vendorId, ibanTail: tail(b.iban) },
        },
      });
      await this.notifications.enqueueVendor(
        { code: 'bank_account_verified', vendorId, vars: { bank: b.bankName, iban_tail: tail(b.iban), link: LINK } },
        tx,
      );
    });
  }
}
