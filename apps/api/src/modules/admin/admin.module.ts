import { Module } from '@nestjs/common';
import {
  AdminContentController,
  AdminOperationsController,
  AdminReportsController,
  PublicContentController,
} from './api/admin.controllers';
import { ContentService } from './application/content.service';
import { OperationsService } from './application/operations.service';
import { ReportsService } from './application/reports.service';

/**
 * لوحة الإدارة — المرحلة 11. تقرأ من كل الجداول ولا تكتب في دفتر ولا في
 * حالة طلب: تلك تمرّ بوحداتها (الطلبات، المال، البائعون، الكتالوج).
 */
@Module({
  controllers: [AdminReportsController, AdminOperationsController, AdminContentController, PublicContentController],
  providers: [ReportsService, OperationsService, ContentService],
  exports: [ReportsService],
})
export class AdminModule {}
