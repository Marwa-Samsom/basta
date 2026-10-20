import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { ForbiddenActorError, vendorScopeOf, type Actor } from '../../../common/security/actor';
import { CurrentActor, RequirePermission, Roles } from '../../../common/security/decorators';
import { FinanceService } from '../application/finance.service';
import { ReleaseScheduler } from '../application/release-scheduler';
import { assertOneOf, IsCalendarDate } from '../../../common/validation';
import { pageOf, sortOf, termOf } from '../../../common/paging';
import { PayoutStatus } from '@prisma/client';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('المورد غير موجود.') });

function vendorIdOf(actor: Actor): string {
  try {
    return vendorScopeOf(actor).vendorId;
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

const range = (from?: string, to?: string) => ({
  ...(from ? { from: new Date(from) } : {}),
  ...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {}),
});

export class PayoutDto {
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  /** بالوحدات الصغرى نصاً — لا عدد عشري يمرّ في مال (ADR-001) */
  @Matches(/^[1-9][0-9]{0,15}$/, { message: 'المبلغ عدد صحيح موجب بالوحدات الصغرى.' })
  amountMinorUnits!: string;
}

export class StatementQueryDto {
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;

  /** آخر قيد في الصفحة السابقة (nextCursor) — الكشف صفحات */
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class ReasonDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class PaidDto {
  @IsString()
  @Length(3, 120)
  transferReference!: string;
}

export class CommissionDto {
  /** نسبة عامة لكل المنصة، أو خاصة بمتجر — لا مستوى فئة (14 أكتوبر 2026) */
  @IsIn(['global', 'vendor'], { message: 'النطاق: عامة (global) أو متجر (vendor).' })
  scope!: 'global' | 'vendor';

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsInt()
  @Min(0)
  @Max(5000)
  rateBps!: number;
}

@ApiTags('vendor-finance')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/finance')
export class VendorFinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('wallets')
  wallets(@CurrentActor() a: Actor) {
    return this.finance.wallets(vendorIdOf(a));
  }

  @Get('statement')
  statement(@CurrentActor() a: Actor, @Query() q: StatementQueryDto) {
    return this.finance.statement(vendorIdOf(a), q.currency, range(q.from, q.to), q.cursor);
  }

  @Get('statement.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="basta-statement.csv"')
  statementCsv(@CurrentActor() a: Actor, @Query() q: StatementQueryDto) {
    return this.finance.statementCsv(vendorIdOf(a), q.currency, range(q.from, q.to));
  }

  @Get('payouts')
  payouts(@CurrentActor() a: Actor) {
    return this.finance.payouts({ vendorId: vendorIdOf(a) });
  }

  /** المالك وحده يسحب — الموظّف يرى ولا يحرّك المال */
  @Post('payouts')
  @Roles('vendor_owner')
  requestPayout(@CurrentActor() a: Actor, @Body() dto: PayoutDto) {
    return this.finance.requestPayout(vendorIdOf(a), a.userId, {
      currency: dto.currency,
      amountMinorUnits: BigInt(dto.amountMinorUnits),
    });
  }
}

@ApiTags('admin-finance')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly release: ReleaseScheduler,
  ) {}

  /** تشغيل تحرير الأرصدة المستحقة الآن بدل انتظار الساعة — الشروط نفسها (ADR-007) */
  @Post('release-due')
  @RequirePermission('payouts.approve')
  @HttpCode(HttpStatus.OK)
  async releaseDue() {
    return { released: await this.release.tick() };
  }

  @Get('payouts')
  @RequirePermission('payouts.approve')
  payouts(@Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('sort') sort?: string) {
    const term = termOf(search);
    const order = sortOf(sort);
    return this.finance.adminPayouts({
      ...(status ? { status: assertOneOf(status, Object.values(PayoutStatus), 'حالة السحب') } : {}),
      ...(term ? { search: term } : {}),
      page: pageOf(page),
      ...(order ? { sort: order } : {}),
    });
  }

  @Post('payouts/:id/approve')
  @RequirePermission('payouts.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.finance.approvePayout(a.userId, id);
  }

  @Post('payouts/:id/paid')
  @RequirePermission('payouts.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  paid(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: PaidDto) {
    return this.finance.markPaid(a.userId, id, dto.transferReference);
  }

  @Post('payouts/:id/reject')
  @RequirePermission('payouts.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: ReasonDto) {
    return this.finance.rejectPayout(a.userId, id, dto.reason);
  }

  @Get('commissions')
  @RequirePermission('commissions.edit')
  commissions() {
    return this.finance.commissionRules();
  }

  @Delete('commissions/vendor/:vendorId')
  @RequirePermission('commissions.edit')
  @ApiOperation({ summary: 'إلغاء نسبة المتجر الخاصة — يعود إلى النسبة العامة من الآن' })
  endVendorCommission(@CurrentActor() a: Actor, @Param('vendorId', new ParseUUIDPipe()) vendorId: string) {
    return this.finance.endVendorCommission(a.userId, vendorId);
  }

  @Post('commissions')
  @RequirePermission('commissions.edit')
  setCommission(@CurrentActor() a: Actor, @Body() dto: CommissionDto) {
    return this.finance.setCommission(a.userId, {
      scope: dto.scope,
      vendorId: dto.vendorId ?? null,
      rateBps: dto.rateBps,
    });
  }

  @Get('platform')
  @RequirePermission('payouts.approve')
  platform() {
    return this.finance.platformSummary();
  }
}
