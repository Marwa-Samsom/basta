import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InvalidInputError } from '../../../common/errors/domain-error';
import type { Actor } from '../../../common/security/actor';
import {
  CurrentActor,
  Public,
  RequirePermission,
  Roles,
} from '../../../common/security/decorators';
import { CategoryService } from '../application/category.service';
import { ProductImageService } from '../application/product-image.service';
import { ProductImportService } from '../application/product-import.service';
import { ProductService } from '../application/product.service';
import { IMPORT_MAX_BYTES, ImportFileRejectedError } from '../domain/import-plan';
import { IMAGE_MAX_BYTES, ImageRejectedError } from '../infrastructure/product-images';
import {
  AdjustStockDto,
  CreateAttributeDto,
  CreateCategoryDto,
  CreateProductDto,
  LinkAttributeDto,
  ListProductsQueryDto,
  MoveCategoryDto,
  RejectProductDto,
  AttributeValueCreateDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/catalog.dto';
import { scopeOf, uuidParam } from './scope';

/**
 * يقرأ ملفاً واحداً من طلب multipart بحدّ حجم خاص بالمسار.
 * الحقول النصّية تُقرأ مما سبق الملف في الطلب — FormData يحفظ ترتيب الإضافة.
 */
async function readSingleFile(
  req: FastifyRequest,
  maxBytes: number,
  tooLarge: () => Error,
): Promise<{ buffer: Buffer; fields: Record<string, string> }> {
  let part: MultipartFile | undefined;
  try {
    part = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 10 } });
  } catch {
    throw new InvalidInputError('الطلب ليس multipart/form-data صالحاً. أرفق الملف في الحقل file.');
  }
  if (!part) throw new InvalidInputError('أرفق ملفاً في الحقل file.');

  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
    throw err;
  }

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(part.fields)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single && single.type === 'field' && typeof single.value === 'string') fields[name] = single.value;
  }
  return { buffer, fields };
}

// ============================================================================ عام

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'شجرة الفئات الفعّالة' })
  tree() {
    return this.categories.tree();
  }

  @Public()
  @Get(':id/attributes')
  @ApiOperation({ summary: 'سمات الفئة مع ما ترثه من أسلافها' })
  attributes(@Param('id', uuidParam) id: string) {
    return this.categories.effectiveAttributes(id);
  }
}

// ============================================================================ الإدارة

@ApiTags('admin/catalog')
@ApiBearerAuth()
@Roles('admin')
@RequirePermission('catalog.manage')
@Controller('admin')
export class AdminCatalogController {
  constructor(
    private readonly categories: CategoryService,
    private readonly products: ProductService,
  ) {}

  @Post('categories')
  @ApiOperation({ summary: 'إنشاء فئة — حتى أربعة مستويات' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', uuidParam) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Post('categories/:id/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'نقل فئة بفرعها كاملاً' })
  moveCategory(@Param('id', uuidParam) id: string, @Body() dto: MoveCategoryDto) {
    return this.categories.move(id, dto.parentId ?? null);
  }

  @Post('attributes')
  createAttribute(@Body() dto: CreateAttributeDto) {
    return this.categories.createAttribute(dto);
  }

  @Post('attributes/:id/values')
  addAttributeValue(@Param('id', uuidParam) id: string, @Body() dto: AttributeValueCreateDto) {
    return this.categories.addAttributeValue(id, dto);
  }

  @Put('categories/:id/attributes/:attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async linkAttribute(
    @Param('id', uuidParam) id: string,
    @Param('attributeId', uuidParam) attributeId: string,
    @Body() dto: LinkAttributeDto,
  ): Promise<void> {
    await this.categories.linkAttribute(id, attributeId, dto);
  }

  @Delete('categories/:id/attributes/:attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkAttribute(
    @Param('id', uuidParam) id: string,
    @Param('attributeId', uuidParam) attributeId: string,
  ): Promise<void> {
    await this.categories.unlinkAttribute(id, attributeId);
  }

  @Post('products/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'رفض منتج منشور بسبب يراه البائع' })
  async rejectProduct(@Param('id', uuidParam) id: string, @Body() dto: RejectProductDto): Promise<void> {
    await this.products.reject(id, dto.reason);
  }
}

// ============================================================================ البائع

@ApiTags('vendor/catalog')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor')
export class VendorCatalogController {
  constructor(
    private readonly products: ProductService,
    private readonly images: ProductImageService,
    private readonly importer: ProductImportService,
  ) {}

  @Get('products')
  list(@CurrentActor() actor: Actor, @Query() query: ListProductsQueryDto) {
    return this.products.list(scopeOf(actor), query);
  }

  @Post('products')
  @ApiOperation({ summary: 'إنشاء منتج بمتغيّراته ومخزونها — يُحفظ مسودة' })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateProductDto) {
    return this.products.create(scopeOf(actor), actor, dto);
  }

  @Get('products/:id')
  get(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string) {
    return this.products.get(scopeOf(actor), id);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'تعديل المنتج — variants إن أُرسلت هي المجموعة الحيّة كاملةً' })
  update(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(scopeOf(actor), actor, id, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف المنتج — أرشفة تحفظ تاريخ مخزونه وطلباته' })
  async remove(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string): Promise<void> {
    await this.products.remove(scopeOf(actor), id);
  }

  @Post('products/:id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string) {
    return this.products.publish(scopeOf(actor), id);
  }

  @Post('products/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string) {
    return this.products.unpublish(scopeOf(actor), id);
  }

  @Patch('products/:id/variants/:variantId/stock')
  @ApiOperation({ summary: 'تعديل مخزون متغيّر: setTo جرد فعلي، أو delta حدث' })
  adjustStock(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Param('variantId', uuidParam) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    if ((dto.delta === undefined) === (dto.setTo === undefined)) {
      throw new InvalidInputError('أرسل setTo (الكمية الموجودة فعلاً) أو delta (تغيير بحدث) — واحداً منهما فقط.');
    }
    return this.products.adjustStock(scopeOf(actor), actor, id, variantId, {
      change: dto.setTo !== undefined ? { setTo: dto.setTo } : { delta: dto.delta ?? 0 },
      reason: dto.reason,
      note: dto.note,
      lowStockThreshold: dto.lowStockThreshold,
    });
  }

  @Post('products/:id/images')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'رفع صورة — تُحوَّل إلى WebP و AVIF. الحقول النصّية قبل الملف' })
  async addImage(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string, @Req() req: FastifyRequest) {
    const scope = scopeOf(actor);
    const { buffer, fields } = await readSingleFile(
      req,
      IMAGE_MAX_BYTES,
      () => new ImageRejectedError(`حجم الصورة أكبر من ${IMAGE_MAX_BYTES / (1024 * 1024)} م.ب.`),
    );
    return this.images.add(scope, id, buffer, {
      variantId: fields['variantId'] || null,
      altAr: fields['altAr'] ?? null,
      altEn: fields['altEn'] ?? null,
    });
  }

  @Delete('products/:id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Param('imageId', uuidParam) imageId: string,
  ): Promise<void> {
    await this.images.remove(scopeOf(actor), id, imageId);
  }

  @Get('inventory/low-stock')
  @ApiOperation({ summary: 'متغيّرات بلغت عتبة النفاد، الأقدم أولاً' })
  lowStock(@CurrentActor() actor: Actor) {
    return this.products.lowStock(scopeOf(actor));
  }

  @Get('catalog/import/template')
  @ApiOperation({ summary: 'قالب CSV عربي للاستيراد الجماعي' })
  template(@CurrentActor() actor: Actor, @Res({ passthrough: true }) reply: FastifyReply): string {
    scopeOf(actor);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="basta-products-template.csv"');
    return this.importer.templateCsv();
  }

  @Post('catalog/import')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'استيراد CSV أو xlsx — الأسطر الصالحة تُكتب والخاطئة تُبلَّغ برقمها' })
  async import(@CurrentActor() actor: Actor, @Req() req: FastifyRequest) {
    const scope = scopeOf(actor);
    const { buffer } = await readSingleFile(
      req,
      IMPORT_MAX_BYTES,
      () => new ImportFileRejectedError(`حجم الملف أكبر من ${IMPORT_MAX_BYTES / (1024 * 1024)} م.ب. قسّمه إلى ملفات أصغر.`),
    );
    return this.importer.import(scope, actor, buffer);
  }
}
