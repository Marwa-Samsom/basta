import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { dirOf, like, pageArgs, type SortOrder } from '../../../common/paging';
import { StorefrontService } from '../../catalog/public';
import { NotificationsService } from '../../notifications/public';
import { DisplayCurrencyService, fxSpreadBps } from '../../pricing/public';
import { acceptBy, acceptanceDueSince } from '../domain/acceptance';
import { PERMISSION_CODES, SETTINGS_SPEC } from '../domain/permissions';

const PAGE = 50;
/** طلبات الصفحة الواحدة في ملف العميل */
const CUSTOMER_ORDERS_PAGE = 20;

/**
 * عمليات الإدارة اليومية — بوابة 11 البند الأول: لا عملية تشغيلية تحتاج فتح
 * قاعدة البيانات. كل تغيير هنا يُكتب في سجل التدقيق بقيمته قبل وبعد.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storefront: StorefrontService,
    private readonly display: DisplayCurrencyService,
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

  /**
   * المديرون بالتصفية («بلا تحقّق بخطوتين») والبحث (الاسم أو البريد) وخمسين خمسين، ومعها عدّاد كل
   * تصفية. كانوا يُقرؤون كلهم — 4491 مديراً على قاعدة التطوير (3 نوفمبر 2026). `iAmOwner`: هل
   * الطالب مالك المنصة — كانت اللوحة تبحث عنه في القائمة نفسها، وقد لا يكون في صفحتها.
   */
  async admins(actorId: string, q: { filter?: 'tfa_off'; search?: string; page: number }) {
    const t = q.search;
    const base: Prisma.UserWhereInput = { roles: { some: { role: 'admin' } } };
    const where: Prisma.UserWhereInput = {
      ...base,
      ...(q.filter === 'tfa_off' ? { totpEnabledAt: null } : {}),
      ...(t ? { OR: [{ fullName: like(t) }, { email: like(t) }] } : {}),
    };
    const [rows, total, all, tfaOff, me] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(q.page),
        select: {
          id: true, email: true, fullName: true, status: true, totpEnabledAt: true, lastLoginAt: true, isPlatformOwner: true,
          permissions: { select: { permission: true } },
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: base }),
      this.prisma.user.count({ where: { ...base, totpEnabledAt: null } }),
      this.prisma.user.findUnique({ where: { id: actorId }, select: { isPlatformOwner: true } }),
    ]);
    return {
      items: rows.map(({ isPlatformOwner, ...u }) => ({
        ...u,
        isOwner: isPlatformOwner,
        twoFactor: !!u.totpEnabledAt,
        permissions: u.permissions.map((p) => p.permission),
      })),
      total,
      counts: { all, tfa_off: tfaOff },
      iAmOwner: me?.isPlatformOwner ?? false,
    };
  }

  /**
   * لا يُعطي مدير ما لا يملك ولا يأخذ ما لا يملك. صلاحية users.manage كانت
   * تكفي لمنح النفس كل شيء وسحب الإدارة من أي أحد — ومنهم المدير الأول.
   *
   * - كل صلاحية تتغيّر (تُضاف أو تُسحب) يحملها الفاعل نفسه: لا يرفع نفسه، ولا
   *   يجرّد مديراً مما لم يُعطَه هو
   * - مالك المنصة لا يغيّره غيره، وهو وحده فوق القاعدة الأولى
   */
  private async assertMayChange(actorId: string, target: { id: string; isOwner: boolean; before: readonly string[] }, after: readonly string[]) {
    const actor = await this.prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { isPlatformOwner: true, permissions: { select: { permission: true } } },
    });
    if (target.isOwner && target.id !== actorId) {
      throw new ForbiddenError('مالك المنصة لا تتغيّر صلاحياته ولا تُسحب إدارته إلا منه هو.');
    }
    if (actor.isPlatformOwner) return;
    const held = new Set(actor.permissions.map((p) => p.permission));
    const changed = [...after.filter((p) => !target.before.includes(p)), ...target.before.filter((p) => !after.includes(p))];
    const beyond = [...new Set(changed.filter((p) => !held.has(p)))];
    if (beyond.length > 0) {
      throw new ForbiddenError(`لا تمنح ولا تسحب صلاحية لا تحملها أنت: ${beyond.join('، ')}. اطلب ذلك من مالك المنصة.`, { permissions: beyond });
    }
  }

  private async adminTarget(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformOwner: true, permissions: { select: { permission: true } }, roles: { select: { role: true } } },
    });
    return {
      id: userId,
      isOwner: u?.isPlatformOwner ?? false,
      isAdmin: u?.roles.some((r) => r.role === 'admin') ?? false,
      before: u?.permissions.map((p) => p.permission) ?? [],
    };
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
    // المنح يستبدل صلاحيات الحساب كلها — فما يُزال منها كما يُضاف يحكمه المانح
    await this.assertMayChange(actorId, await this.adminTarget(user.id), permissions);
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
    const target = await this.adminTarget(userId);
    if (!target.isAdmin) throw new NotFoundError('ليس مديراً.', { userId });
    await this.assertMayChange(actorId, target, permissions);
    const before = target.before.map((permission) => ({ permission }));
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
    const target = await this.adminTarget(userId);
    if (!target.isAdmin) throw new NotFoundError('ليس مديراً.', { userId });
    // السحب يزيل كل صلاحياته: مدير يحمل ما لا يحمله الفاعل لا يسحبه الفاعل
    await this.assertMayChange(actorId, target, []);
    await this.prisma.$transaction([
      this.prisma.adminPermission.deleteMany({ where: { userId } }),
      this.prisma.userRole.deleteMany({ where: { userId, role: 'admin' } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit(actorId, 'admin.revoke', 'User', userId);
  }

  // ---------------------------------------------------------- AD-21 العملاء

  async customers(q: { search?: string; page?: number; sort?: SortOrder }) {
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
        orderBy: [{ createdAt: dirOf(q.sort, 'newest') }, { id: 'asc' }],
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
    };
  }

  /**
   * طلبات العميل في ملفه، الأحدث أولاً وعشرين عشرين. كانت آخر عشرين مع الملف بلا ما قبلها ولا
   * عددها (3 نوفمبر 2026).
   */
  async customerOrders(id: string, page: number) {
    const where: Prisma.OrderWhereInput = { customerUserId: id };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: [{ placedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(page, CUSTOMER_ORDERS_PAGE),
        select: { id: true, orderNumber: true, status: true, currency: true, grandTotalMinorUnits: true, placedAt: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map((o) => ({ ...o, grandTotalMinorUnits: o.grandTotalMinorUnits.toString() })), total };
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
        data: { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null },
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

  async auditLog(q: { actor?: string; action?: string; entityType?: string; entityId?: string; from?: Date; to?: Date; page?: number; sort?: SortOrder }) {
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
        orderBy: [{ createdAt: dirOf(q.sort, 'newest') }, { id: 'asc' }],
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

  async setSetting(actorId: string, key: string, raw: unknown) {
    const spec = SETTINGS_SPEC[key];
    if (!spec) throw new NotFoundError('إعداد غير قابل للتحرير.', { key });
    const value = spec.kind === 'text' && typeof raw === 'string' ? raw.trim() : raw;
    if (spec.kind === 'int') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < (spec.min ?? 0) || value > (spec.max ?? Infinity)) {
        throw new InvalidInputError(`القيمة عدد صحيح بين ${spec.min} و ${spec.max}.`);
      }
    }
    if (spec.kind === 'enum' && !spec.options?.includes(String(value))) throw new InvalidInputError('قيمة غير مسموحة.');
    if (spec.kind === 'text') {
      if (typeof value !== 'string') throw new InvalidInputError('القيمة نصّ.');
      // الفراغ يمحو القيمة (إيقاف وجهة تحويل مثلاً) — والنمط يُفحص على ما كُتب وحده
      if (value.length > (spec.maxLength ?? 200)) throw new InvalidInputError(`أطول من ${spec.maxLength ?? 200} حرفاً.`);
      if (value && spec.pattern && !new RegExp(spec.pattern).test(value)) {
        throw new InvalidInputError(spec.hint ? `صيغة غير صحيحة — ${spec.hint}.` : 'صيغة غير صحيحة.');
      }
    }
    if (spec.kind === 'currency') {
      const c = await this.prisma.currency.findUnique({ where: { code: String(value) } });
      if (!c) throw new InvalidInputError('عملة غير معروفة.');
      // عملة الزائر الجديد يجب أن تُعرض: موقوفة أو بلا سعر صرف تسقط بصمت إلى غيرها
      if (key === 'default_display_currency' && !(await this.display.isAvailable(c.code))) {
        throw new InvalidInputError('هذه العملة موقوفة أو بلا سعر صرف نافذ — أضف سعرها أولاً.');
      }
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

  async currencies(now: Date = new Date()) {
    const [currencies, spread, current] = await Promise.all([
      this.prisma.currency.findMany({ orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
      this.prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }),
      this.currentRates(now),
    ]);
    return {
      // ما يُطبَّق فعلاً — كان الغائب يُعرض 0 والدفع يحسبه 200، والتالف «NaN%»
      spreadBps: fxSpreadBps(spread?.valueJson),
      currencies: currencies.map((c) => ({
        ...c,
        minPayoutMinorUnits: c.minPayoutMinorUnits.toString(),
        currentRate: current.get(c.code)?.rate.toString() ?? (c.code === 'USD' ? '1' : null),
      })),
    };
  }

  /**
   * السعر الساري لكل عملة: الأحدث قبل اللحظة، كما يسعّر الدفع (display-currency usdRates). كان يُؤخذ من
   * أحدث 200 سطر في السجلّ، فعملة سعرها أقدم منها تُعرض «—» وهي مسعَّرة (ACFG-016، 2 نوفمبر 2026).
   */
  private async currentRates(now: Date) {
    const rows = await this.prisma.exchangeRate.findMany({
      where: { baseCode: 'USD', effectiveAt: { lte: now } },
      orderBy: [{ quoteCode: 'asc' }, { effectiveAt: 'desc' }],
      distinct: ['quoteCode'],
      select: { id: true, quoteCode: true, rate: true },
    });
    return new Map(rows.map((r) => [r.quoteCode, r]));
  }

  /** سجلّ أسعار الصرف بصفحات، الأحدث أولاً، والساري لكل عملة معلَّم — كانت الصفحة تقصّه على أحدث 50 بلا «المزيد» */
  async rateHistory(page = 1, now: Date = new Date()) {
    const where = { baseCode: 'USD' };
    const [rows, total, current] = await Promise.all([
      this.prisma.exchangeRate.findMany({ where, orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }], skip: (Math.max(1, page) - 1) * PAGE, take: PAGE }),
      this.prisma.exchangeRate.count({ where }),
      this.currentRates(now),
    ]);
    const ids = new Set([...current.values()].map((r) => r.id));
    return { items: rows.map((h) => ({ ...h, rate: h.rate.toString(), current: ids.has(h.id) })), total };
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
    // دولار الفهرس لمنتجات هذه العملة تغيّر — ترتيب البحث بالسعر يتبعه. الفشل لا يُسقط الحفظ
    void this.storefront.syncCurrency(quote).catch(() => undefined);
    return { ...row, rate: row.rate.toString() };
  }

  // -------------------------------------------------- AD-12 و AD-15 الطلبات

  /** `due: 'acceptance'` — ما قاربت مهلة قبوله وحده، بقاعدة بطاقة اللوحة نفسها (domain/acceptance) */
  async orders(q: { search?: string; status?: string; page?: number; due?: 'acceptance'; sort?: SortOrder }) {
    const t = q.search?.trim();
    const now = new Date();
    const deadlineHours = Number((await this.prisma.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } }))?.valueJson) || 48;
    const dueSince = acceptanceDueSince(deadlineHours, now);
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { not: 'pending_payment' } }),
      ...(q.due === 'acceptance' ? { subOrders: { some: { status: 'awaiting_vendor', placedAt: { lt: dueSince } } } } : {}),
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
        orderBy: [{ placedAt: dirOf(q.sort, 'newest') }, { id: 'asc' }],
        skip: (Math.max(1, q.page ?? 1) - 1) * PAGE,
        take: PAGE,
        select: {
          orderNumber: true, status: true, currency: true, grandTotalMinorUnits: true, placedAt: true, guestEmail: true,
          customer: { select: { fullName: true, email: true } },
          payment: { select: { status: true } },
          subOrders: { select: { id: true, subOrderNumber: true, status: true, placedAt: true, vendor: { select: { nameAr: true } } } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: items.map((o) => ({
        ...o,
        grandTotalMinorUnits: o.grandTotalMinorUnits.toString(),
        subOrders: o.subOrders.map(({ placedAt, ...s }) => {
          const waiting = s.status === 'awaiting_vendor';
          return { ...s, acceptBy: waiting ? acceptBy(placedAt, deadlineHours) : null, acceptanceDue: waiting && placedAt < dueSince };
        }),
      })),
      total,
    };
  }

  /**
   * AD-15 طلبات الإرجاع — بالحالة والبحث وخمسين خمسين. البحث برقم الطلب أو طلب المتجر، أو اسم
   * المتجر، أو اسم المشتري أو بريده.
   */
  async returns(q: { status?: string; search?: string; page: number; sort?: SortOrder }) {
    const t = q.search;
    const where: Prisma.ReturnRequestWhereInput = { ...(q.status ? { status: q.status } : {}), ...(t ? { subOrder: subOrderMatching(t) } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        orderBy: [{ requestedAt: dirOf(q.sort, 'newest') }, { id: 'asc' }],
        ...pageArgs(q.page),
        include: { subOrder: { select: { id: true, subOrderNumber: true, status: true, vendor: { select: { nameAr: true } } } } },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return { items, total };
  }

  /** AD-15 المبالغ المعادة — بالبحث نفسه أو بمرجع البوابة، وخمسين خمسين */
  async refunds(q: { search?: string; page: number; sort?: SortOrder }) {
    const t = q.search;
    const where: Prisma.RefundWhereInput = t ? { OR: [{ subOrder: subOrderMatching(t) }, { providerRefundId: like(t) }] } : {};
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        orderBy: [{ createdAt: dirOf(q.sort, 'newest') }, { id: 'asc' }],
        ...pageArgs(q.page),
        include: { subOrder: { select: { subOrderNumber: true, settlementCurrency: true, vendorId: true, vendor: { select: { nameAr: true } }, order: { select: { currency: true } } } } },
      }),
      this.prisma.refund.count({ where }),
    ]);
    // رصيد البائع السالب بجانب استرداده — لمتاجر هذه الصفحة وحدها
    const negatives = await this.prisma.wallet.findMany({
      where: { vendorId: { in: [...new Set(rows.map((r) => r.subOrder.vendorId))] }, balanceAvailableMinorUnits: { lt: 0 } },
      select: { vendorId: true, currency: true, balanceAvailableMinorUnits: true },
    });
    // ما ردّته المنصة من حصّتها لكل استرداد (عمولة معكوسة، ضريبة) — قيودها تحمل refundId
    const platformRows = await this.prisma.platformLedgerEntry.groupBy({
      by: ['refundId', 'direction'],
      where: { refundId: { in: rows.map((r) => r.id) } },
      _sum: { amountMinorUnits: true },
    });
    const platformBack = (refundId: string): bigint =>
      platformRows
        .filter((p) => p.refundId === refundId)
        .reduce((a, p) => a + (p.direction === 'debit' ? 1n : -1n) * (p._sum.amountMinorUnits ?? 0n), 0n);
    return {
      items: rows.map((r) => ({
        ...r,
        amountMinorUnits: r.amountMinorUnits.toString(),
        vendorAmountMinorUnits: r.vendorAmountMinorUnits?.toString() ?? null,
        // ما تحمّله البائع فعلاً: ما رُدّ بعملته ناقص ما ردّته المنصة — المال محفوظ
        // (audit_money_conservation) فالباقي من قيوده. لا «ما رُدّ للمشتري» كلّه (ADM-076)
        vendorChargeMinorUnits: r.vendorAmountMinorUnits === null ? null : (r.vendorAmountMinorUnits - platformBack(r.id)).toString(),
        currency: r.subOrder.order.currency,
        vendorNegative:
          negatives.find((n) => n.vendorId === r.subOrder.vendorId && n.currency === r.subOrder.settlementCurrency)?.balanceAvailableMinorUnits.toString() ?? null,
      })),
      total,
    };
  }
}

/** طلب متجر برقمه أو رقم طلبه، أو باسم متجره، أو باسم المشتري أو بريده */
function subOrderMatching(t: string): Prisma.SubOrderWhereInput {
  return {
    OR: [
      { subOrderNumber: like(t) },
      { vendor: { nameAr: like(t) } },
      { order: { OR: [{ orderNumber: like(t) }, { customer: { OR: [{ email: like(t) }, { fullName: like(t) }] } }] } },
    ],
  };
}
