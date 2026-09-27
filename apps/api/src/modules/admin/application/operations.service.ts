import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/public';
import { PERMISSION_CODES, SETTINGS_SPEC } from '../domain/permissions';

const PAGE = 50;

/**
 * عمليات الإدارة اليومية — بوابة 11 البند الأول: لا عملية تشغيلية تحتاج فتح
 * قاعدة البيانات. كل تغيير هنا يُكتب في سجل التدقيق بقيمته قبل وبعد.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private audit(actorUserId: string, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId,
        actorRole: 'admin',
        action,
        entityType,
        entityId,
        beforeJson: (before ?? null) as Prisma.InputJsonValue,
        afterJson: (after ?? null) as Prisma.InputJsonValue,
      },
    });
  }

  // ---------------------------------------------------------- AD-23 الإدارة

  async admins() {
    const rows = await this.prisma.user.findMany({
      where: { roles: { some: { role: 'admin' } } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, fullName: true, status: true, totpEnabledAt: true, lastLoginAt: true,
        permissions: { select: { permission: true } },
      },
    });
    return rows.map((u) => ({ ...u, twoFactor: !!u.totpEnabledAt, permissions: u.permissions.map((p) => p.permission) }));
  }

  /**
   * منح الإدارة لحساب قائم: المدعوّ ينشئ حسابه بنفسه ثم يُمنح الدور هنا —
   * فلا كلمة مرور تمرّ بيد أحد. التحقق الثنائي إلزامي عند أول دخول.
   */
  async grantAdmin(actorId: string, email: string, permissions: string[]) {
    const bad = permissions.filter((p) => !PERMISSION_CODES.includes(p));
    if (bad.length) throw new InvalidInputError(`صلاحيات غير معروفة: ${bad.join('، ')}`);
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, status: true } });
    if (!user) throw new NotFoundError('لا حساب بهذا البريد. اطلب من الشخص إنشاء حسابه أولاً.');
    if (user.status !== 'active') throw new ConflictError('الحساب غير نشط.');
    await this.prisma.$transaction([
      this.prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role: 'admin' } },
        create: { userId: user.id, role: 'admin' },
        update: {},
      }),
      this.prisma.adminPermission.deleteMany({ where: { userId: user.id } }),
      this.prisma.adminPermission.createMany({ data: permissions.map((permission) => ({ userId: user.id, permission })) }),
    ]);
    await this.audit(actorId, 'admin.grant', 'User', user.id, null, { permissions });
    return { userId: user.id };
  }

  async setPermissions(actorId: string, userId: string, permissions: string[]) {
    const bad = permissions.filter((p) => !PERMISSION_CODES.includes(p));
    if (bad.length) throw new InvalidInputError(`صلاحيات غير معروفة: ${bad.join('، ')}`);
    // لا يسحب أحد من نفسه صلاحية إدارة المستخدمين — وإلا لم يبقَ من يعيدها
    if (actorId === userId && !permissions.includes('users.manage')) {
      throw new ConflictError('لا تسحب من نفسك صلاحية إدارة المستخدمين.');
    }
    const before = await this.prisma.adminPermission.findMany({ where: { userId }, select: { permission: true } });
    await this.prisma.$transaction([
      this.prisma.adminPermission.deleteMany({ where: { userId } }),
      this.prisma.adminPermission.createMany({ data: permissions.map((permission) => ({ userId, permission })) }),
      // الرمز الحالي يحمل الصلاحيات القديمة: الجلسات تُنهى ليُعاد الدخول بها
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit(actorId, 'admin.permissions', 'User', userId, { permissions: before.map((p) => p.permission) }, { permissions });
  }

  async revokeAdmin(actorId: string, userId: string) {
    if (actorId === userId) throw new ConflictError('لا تسحب الإدارة من نفسك.');
    await this.prisma.$transaction([
      this.prisma.adminPermission.deleteMany({ where: { userId } }),
      this.prisma.userRole.deleteMany({ where: { userId, role: 'admin' } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit(actorId, 'admin.revoke', 'User', userId);
  }

  // ---------------------------------------------------------- AD-21 العملاء

  async customers(q: { search?: string; page?: number }) {
    const where: Prisma.UserWhereInput = {
      roles: { some: { role: 'customer' } },
      deletedAt: null,
      ...(q.search
        ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }, { fullName: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, q.page ?? 1) - 1) * PAGE,
        take: PAGE,
        select: { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true, _count: { select: { orders: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(({ _count, ...u }) => ({ ...u, orders: _count.orders })), total };
  }

  async customer(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, fullName: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true,
        totpEnabledAt: true, roles: { select: { role: true } },
        orders: { orderBy: { placedAt: 'desc' }, take: 20, select: { orderNumber: true, status: true, currency: true, grandTotalMinorUnits: true, placedAt: true } },
      },
    });
    if (!u) throw new NotFoundError('العميل غير موجود.', { id });
    const disputes = await this.prisma.dispute.count({ where: { openedByUserId: id } });
    const { totpEnabledAt, roles, ...rest } = u;
    return {
      ...rest,
      totpEnabled: totpEnabledAt !== null,
      // المدير لا يُعاد ضبط تحققه من هنا — الواجهة تُخفي الزرّ، والخادم يرفض
      totpResettable: totpEnabledAt !== null && !roles.some((r) => r.role === 'admin'),
      disputes,
      orders: u.orders.map((o) => ({ ...o, grandTotalMinorUnits: o.grandTotalMinorUnits.toString() })),
    };
  }

  /** التعليق يُنهي الجلسات فوراً — الدخول يرفض الحساب غير النشط */
  async setCustomerStatus(actorId: string, id: string, status: 'active' | 'suspended', reason: string) {
    if (status === 'suspended' && reason.trim().length < 5) throw new InvalidInputError('سبب التعليق مطلوب.');
    const { count } = await this.prisma.user.updateMany({ where: { id, deletedAt: null, roles: { none: { role: 'admin' } } }, data: { status } });
    if (count === 0) throw new NotFoundError('العميل غير موجود.', { id });
    if (status === 'suspended') {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit(actorId, status === 'suspended' ? 'customer.suspend' : 'customer.reinstate', 'User', id, null, { reason });
  }

  /**
   * طريق الدعم الأخير لمن أضاع جهاز المصادقة **ورموز الاستعادة معاً**: يُمسح
   * السرّ والرموز، وتُنهى كل الجلسات، ويُبلَّغ صاحب الحساب. السبب إلزامي لأنه
   * يُثبت في التدقيق — إعادة ضبط بلا سبب مكتوب لا تُراجَع.
   *
   * حساب الإدارة مستثنى: تحققه الثنائي إلزامي ولا يُنزع من هنا (SRS A-07).
   * الشرط داخل جملة التحديث نفسها، فلا يمرّ مدير ولا حساب بلا تحقق مفعَّل.
   */
  async resetCustomerTotp(actorId: string, id: string, reason: string): Promise<void> {
    const why = reason.trim();
    if (why.length < 10) throw new InvalidInputError('اكتب سبباً واضحاً — كيف تحقّقت من هوية صاحب الحساب.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id, deletedAt: null, totpEnabledAt: { not: null }, roles: { none: { role: 'admin' } } },
        data: { totpSecretEnc: null, totpEnabledAt: null },
      });
      if (count === 0) throw new NotFoundError('لا حساب عميل بتحقق ثنائي مفعَّل بهذا المعرّف.', { id });
      await tx.totpRecoveryCode.deleteMany({ where: { userId: id } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorUserId: actorId,
          actorRole: 'admin',
          action: 'customer.totp_reset',
          entityType: 'User',
          entityId: id,
          afterJson: { reason: why } as Prisma.InputJsonValue,
        },
      });
      await this.notifications.enqueue({ code: 'totp_reset_by_admin', userId: id, vars: { reason: why } }, tx);
    });
  }

  // ------------------------------------------------------------ AD-24 التدقيق

  async auditLog(q: { actor?: string; action?: string; entityType?: string; entityId?: string; from?: Date; to?: Date; page?: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
      ...(q.actor ? { actor: { OR: [{ email: { contains: q.actor, mode: 'insensitive' } }, { fullName: { contains: q.actor, mode: 'insensitive' } }] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, q.page ?? 1) - 1) * PAGE,
        take: PAGE,
        include: { actor: { select: { email: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }

  // ------------------------------------------------------ AD-26 الإعدادات

  async settings() {
    const rows = await this.prisma.setting.findMany();
    const [taxes, currencies] = await Promise.all([
      this.prisma.taxRate.findMany({ where: { effectiveTo: null }, orderBy: { country: 'asc' } }),
      this.prisma.currency.findMany({ select: { code: true } }),
    ]);
    return {
      settings: Object.entries(SETTINGS_SPEC).map(([key, spec]) => ({
        key,
        ...spec,
        ...(spec.kind === 'currency' ? { options: currencies.map((c) => c.code) } : {}),
        value: rows.find((r) => r.key === key)?.valueJson ?? null,
        updatedAt: rows.find((r) => r.key === key)?.updatedAt ?? null,
      })),
      taxes,
    };
  }

  async setSetting(actorId: string, key: string, value: unknown) {
    const spec = SETTINGS_SPEC[key];
    if (!spec) throw new NotFoundError('إعداد غير قابل للتحرير.', { key });
    if (spec.kind === 'int') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < (spec.min ?? 0) || value > (spec.max ?? Infinity)) {
        throw new InvalidInputError(`القيمة عدد صحيح بين ${spec.min} و ${spec.max}.`);
      }
    }
    if (spec.kind === 'enum' && !spec.options?.includes(String(value))) throw new InvalidInputError('قيمة غير مسموحة.');
    if (spec.kind === 'currency') {
      const c = await this.prisma.currency.findUnique({ where: { code: String(value) } });
      if (!c) throw new InvalidInputError('عملة غير معروفة.');
    }
    const before = await this.prisma.setting.findUnique({ where: { key } });
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, valueJson: value as Prisma.InputJsonValue, updatedBy: actorId },
      update: { valueJson: value as Prisma.InputJsonValue, updatedBy: actorId },
    });
    await this.audit(actorId, 'setting.update', 'Setting', key, { value: before?.valueJson ?? null }, { value });
  }

  /** ضريبة جديدة تُنهي السابقة بتاريخ ولا تحذفها — الطلبات السابقة على لقطتها */
  async setTax(actorId: string, country: string, input: { rateBps: number; isPriceInclusive: boolean }) {
    if (!/^[A-Z]{2}$/.test(country)) throw new InvalidInputError('رمز البلد حرفان.');
    if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 5000) throw new InvalidInputError('النسبة بين 0 و 50%.');
    const now = new Date();
    const before = await this.prisma.taxRate.findFirst({ where: { country, region: null, effectiveTo: null } });
    await this.prisma.$transaction([
      this.prisma.taxRate.updateMany({ where: { country, region: null, effectiveTo: null }, data: { effectiveTo: now } }),
      this.prisma.taxRate.create({ data: { country, rateBps: input.rateBps, isPriceInclusive: input.isPriceInclusive, effectiveFrom: now } }),
    ]);
    await this.audit(actorId, 'tax.set', 'TaxRate', country, before, input);
  }

  // ------------------------------------------------------ AD-11 العملات

  async currencies() {
    const [currencies, spread] = await Promise.all([
      this.prisma.currency.findMany({ orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
      this.prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }),
    ]);
    const history = await this.prisma.exchangeRate.findMany({ where: { baseCode: 'USD' }, orderBy: { effectiveAt: 'desc' }, take: 200 });
    return {
      spreadBps: Number(spread?.valueJson ?? 0),
      currencies: currencies.map((c) => ({
        ...c,
        minPayoutMinorUnits: c.minPayoutMinorUnits.toString(),
        currentRate: history.find((h) => h.quoteCode === c.code)?.rate.toString() ?? (c.code === 'USD' ? '1' : null),
      })),
      history: history.map((h) => ({ ...h, rate: h.rate.toString() })),
    };
  }

  /** سعر جديد إضافة لا تعديل — الجدول للإضافة فقط (ADR-013) */
  async addRate(actorId: string, quote: string, rate: string, source: string) {
    if (!/^\d+(\.\d{1,10})?$/.test(rate) || Number(rate) <= 0) throw new InvalidInputError('السعر عدد موجب حتى عشر خانات.');
    const c = await this.prisma.currency.findUnique({ where: { code: quote } });
    if (!c || quote === 'USD') throw new InvalidInputError('عملة غير صالحة.');
    const row = await this.prisma.exchangeRate.create({
      data: { baseCode: 'USD', quoteCode: quote, rate, source: source.trim() || 'manual', effectiveAt: new Date() },
    });
    await this.audit(actorId, 'fx.add', 'ExchangeRate', row.id, null, { quote, rate, source });
    return { ...row, rate: row.rate.toString() };
  }

  // -------------------------------------------------- AD-12 و AD-15 الطلبات

  async orders(q: { search?: string; status?: string; page?: number }) {
    const t = q.search?.trim();
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { not: 'pending_payment' } }),
      ...(t
        ? {
            OR: [
              { orderNumber: { contains: t, mode: 'insensitive' } },
              { guestEmail: { contains: t, mode: 'insensitive' } },
              { customer: { OR: [{ email: { contains: t, mode: 'insensitive' } }, { fullName: { contains: t, mode: 'insensitive' } }] } },
              { subOrders: { some: { vendor: { nameAr: { contains: t, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (Math.max(1, q.page ?? 1) - 1) * PAGE,
        take: PAGE,
        select: {
          orderNumber: true, status: true, currency: true, grandTotalMinorUnits: true, placedAt: true, guestEmail: true,
          customer: { select: { fullName: true, email: true } },
          payment: { select: { status: true } },
          subOrders: { select: { id: true, subOrderNumber: true, status: true, vendor: { select: { nameAr: true } } } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: items.map((o) => ({ ...o, grandTotalMinorUnits: o.grandTotalMinorUnits.toString() })), total };
  }

  async returns(status?: string) {
    const [requests, refunds] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where: status ? { status } : {},
        orderBy: { requestedAt: 'desc' },
        take: 100,
        include: { subOrder: { select: { id: true, subOrderNumber: true, status: true, vendor: { select: { nameAr: true } } } } },
      }),
      this.prisma.refund.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { subOrder: { select: { subOrderNumber: true, settlementCurrency: true, vendorId: true, vendor: { select: { nameAr: true } }, order: { select: { currency: true } } } } },
      }),
    ]);
    // رصيد البائع السالب بجانب استرداده — AD-15
    const negatives = await this.prisma.wallet.findMany({ where: { balanceAvailableMinorUnits: { lt: 0 } }, select: { vendorId: true, currency: true, balanceAvailableMinorUnits: true } });
    return {
      requests,
      refunds: refunds.map((r) => ({
        ...r,
        amountMinorUnits: r.amountMinorUnits.toString(),
        vendorAmountMinorUnits: r.vendorAmountMinorUnits?.toString() ?? null,
        currency: r.subOrder.order.currency,
        vendorNegative:
          negatives.find((n) => n.vendorId === r.subOrder.vendorId && n.currency === r.subOrder.settlementCurrency)?.balanceAvailableMinorUnits.toString() ?? null,
      })),
    };
  }
}
