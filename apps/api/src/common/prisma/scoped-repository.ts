/**
 * المستودع المحدود بنطاق البائع — ADR-010، وبند إلزامي في بوابة خروج المرحلة 04.
 *
 * الفكرة: لا تُتاح دالة قراءة أو كتابة على بيانات بائع إلا عبر هذا الغلاف،
 * وهو يحقن `vendorId` في **كل** شرط بحث بنفسه. المستدعي لا يستطيع حذف
 * الفلتر لأنه لا يمرّره أصلاً، ولا يستطيع تجاوزه لأن النوع يمنع تركيب
 * `VendorScope` بلا إثبات ملكية.
 *
 * الفارق عن الفحص في المتحكّم: هناك يُنسى الفحص في مسار واحد فيقع الخرق.
 * هنا لا يوجد مسار بلا فلتر — فالنسيان غير ممكن، لا نادر.
 */
import { NotFoundError } from '../errors/domain-error';
import type { VendorScope } from '../security/actor';

/** أقلّ ما يلزم من واجهة Prisma — يُبقي الغلاف قابلاً للاختبار بلا قاعدة بيانات. */
export interface ScopedDelegate<T> {
  findFirst(args: { where: Record<string, unknown>; [k: string]: unknown }): Promise<T | null>;
  findMany(args: { where: Record<string, unknown>; [k: string]: unknown }): Promise<T[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  updateMany(args: { where: Record<string, unknown>; data: unknown }): Promise<{ count: number }>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

export class ScopedRepository<T> {
  constructor(
    private readonly delegate: ScopedDelegate<T>,
    private readonly scope: VendorScope,
    private readonly resourceName: string,
  ) {}

  /** الفلتر يُدمج دائماً، ولا يمكن لشرط المستدعي أن يلغيه. */
  private scoped(where: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...where, vendorId: this.scope.vendorId };
  }

  async findMany(args: Record<string, unknown> = {}): Promise<T[]> {
    const { where, ...rest } = args as { where?: Record<string, unknown> };
    return this.delegate.findMany({ ...rest, where: this.scoped(where) });
  }

  async findFirst(args: Record<string, unknown> = {}): Promise<T | null> {
    const { where, ...rest } = args as { where?: Record<string, unknown> };
    return this.delegate.findFirst({ ...rest, where: this.scoped(where) });
  }

  /**
   * مورد يخصّ بائعاً آخر يُرجع 404 لا 403.
   * الرد نفسه للمعرّف غير الموجود وللمعرّف الموجود لبائع آخر — فلا يستطيع
   * المهاجم أن يستنتج من الرد وجود المورد أصلاً.
   */
  async findByIdOrFail(id: string, args: Record<string, unknown> = {}): Promise<T> {
    const found = await this.findFirst({ ...args, where: { id } });
    if (!found) {
      throw new NotFoundError(`${this.resourceName} غير موجود.`, { id });
    }
    return found;
  }

  async count(where: Record<string, unknown> = {}): Promise<number> {
    return this.delegate.count({ where: this.scoped(where) });
  }

  /** لا يوجد `update` مفرد: كل كتابة تمرّ بـ updateMany المحدود بالنطاق. */
  async updateOwned(id: string, data: unknown): Promise<void> {
    const { count } = await this.delegate.updateMany({ where: this.scoped({ id }), data });
    if (count === 0) {
      throw new NotFoundError(`${this.resourceName} غير موجود.`, { id });
    }
  }

  async deleteOwned(id: string): Promise<void> {
    const { count } = await this.delegate.deleteMany({ where: this.scoped({ id }) });
    if (count === 0) {
      throw new NotFoundError(`${this.resourceName} غير موجود.`, { id });
    }
  }

  get vendorId(): string {
    return this.scope.vendorId;
  }
}
