import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public';
import { NotificationsModule } from '../notifications/public';
import { PricingModule } from '../pricing/public';
import {
  AdminContentController,
  AdminOperationsController,
  AdminReportsController,
  PublicContentController,
} from './api/admin.controllers';
import { AdminCampaignsController, PublicCampaignsController } from './api/campaigns.controller';
import { CampaignsService } from './application/campaigns.service';
import { ContentService } from './application/content.service';
import { OperationsService } from './application/operations.service';
import { ReportsService } from './application/reports.service';

/**
 * لوحة الإدارة — المرحلة 11. تقرأ من كل الجداول ولا تكتب في دفتر ولا في
 * حالة طلب: تلك تمرّ بوحداتها (الطلبات، المال، البائعون، الكتالوج).
 */
@Module({
  imports: [NotificationsModule, CatalogModule, PricingModule],
  controllers: [AdminReportsController, AdminOperationsController, AdminContentController, PublicContentController, AdminCampaignsController, PublicCampaignsController],
  providers: [ReportsService, OperationsService, ContentService, CampaignsService],
  exports: [ReportsService],
})
export class AdminModule {}
