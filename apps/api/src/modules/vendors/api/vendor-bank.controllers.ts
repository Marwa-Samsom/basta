import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor, RequirePermission, Roles } from '../../../common/security/decorators';
import { VendorBankService } from '../application/vendor-bank.service';
import { AddBankAccountDto } from './dto/vendors.dto';
import { scopeOf, uuidParam } from './scope';

/** req.ip من الوسطاء الموثوقين وحدهم (TRUST_PROXY) — لا ترويسة يكتبها الطالب */
const meta = (req: FastifyRequest) => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

/**
 * حسابات البائع البنكية بعد الاعتماد — VD-20. للمالك وحده: الموظّف يدير
 * الطلبات والمخزون، لا وجهة أموال المتجر.
 */
@ApiTags('vendor-bank-accounts')
@ApiBearerAuth()
@Roles('vendor_owner')
@Controller('vendor/bank-accounts')
export class VendorBankController {
  constructor(private readonly banks: VendorBankService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.banks.list(scopeOf(actor)).then((items) => ({ items }));
  }

  @Post()
  @ApiOperation({ summary: 'حساب جديد — غير افتراضي وغير موثَّق حتى يوثّقه مدير' })
  add(@CurrentActor() actor: Actor, @Body() dto: AddBankAccountDto, @Req() req: FastifyRequest) {
    const { password, code, ...input } = dto;
    return this.banks.add(scopeOf(actor), actor, input, { password, code }, meta(req));
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  setDefault(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string) {
    return this.banks.setDefault(scopeOf(actor), actor, id).then((items) => ({ items }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'أرشفة — الحساب لا يُحذف' })
  archive(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string) {
    return this.banks.archive(scopeOf(actor), actor, id).then((items) => ({ items }));
  }
}

/** توثيق حساب أُضيف بعد الاعتماد — المراجع يطابق الآيبان واسم صاحبه مع النشاط */
@ApiTags('admin-vendors')
@ApiBearerAuth()
@Roles('admin')
@RequirePermission('vendors.review')
@Controller('admin/vendors/:vendorId/bank-accounts')
export class AdminVendorBankController {
  constructor(private readonly banks: VendorBankService) {}

  @Get()
  list(@Param('vendorId', uuidParam) vendorId: string) {
    return this.banks.listForAdmin(vendorId).then((items) => ({ items }));
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verify(
    @CurrentActor() actor: Actor,
    @Param('vendorId', uuidParam) vendorId: string,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.banks.verify(actor, vendorId, id);
  }
}
