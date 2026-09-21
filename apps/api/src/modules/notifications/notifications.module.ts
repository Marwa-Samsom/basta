import { Module } from '@nestjs/common';
import { AdminNotificationsController, MyNotificationsController } from './api/notifications.controllers';
import { NotificationsService } from './application/notifications.service';

/** الإشعارات — الطبقة الأدنى: كل وحدة تُدرج فيها داخل معاملتها، ولا تعتمد هي على أحد */
@Module({
  controllers: [MyNotificationsController, AdminNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
