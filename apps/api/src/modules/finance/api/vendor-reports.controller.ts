import { Controller, ForbiddenException, Get, Header, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { ForbiddenActorError, vendorScopeOf, type Actor } from '../../../common/security/actor';
import { CurrentActor, Roles } from '../../../common/security/decorators';
import { VendorReportsService, reportRange } from '../application/vendor-reports.service';

function vendorIdOf(actor: Actor): string {
  try {
    return vendorScopeOf(actor).vendorId;
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

export class ReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

/** VD-19 — أرقام البائع نفسه، من دفتره. المالك والموظّف يريان كما في المحفظة */
@ApiTags('vendor-reports')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/reports')
export class VendorReportsController {
  constructor(private readonly reports: VendorReportsService) {}

  @Get()
  report(@CurrentActor() a: Actor, @Query() q: ReportQueryDto) {
    return this.reports.report(vendorIdOf(a), reportRange(q.from, q.to));
  }

  @Get('export.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="basta-vendor-report.csv"')
  csv(@CurrentActor() a: Actor, @Query() q: ReportQueryDto) {
    return this.reports.csv(vendorIdOf(a), reportRange(q.from, q.to));
  }

  @Get('export.xlsx')
  async xlsx(@CurrentActor() a: Actor, @Query() q: ReportQueryDto, @Res() res: FastifyReply) {
    const buf = await this.reports.xlsx(vendorIdOf(a), reportRange(q.from, q.to));
    return res
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="basta-vendor-report.xlsx"')
      .send(buf);
  }
}
