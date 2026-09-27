import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/public';
import { MyConversationsController, VendorConversationsController } from './api/messaging.controllers';
import { MessagingService } from './application/messaging.service';

/**
 * الرسائل بين المشتري والمتجر — ST-09 · ST-28 · VD-15.
 * تقرأ المنتج والطلب الفرعي والمتجر قراءةً للتحقق من السياق والملكية،
 * وتكتب جدوليها وحدها. التنبيه عبر صندوق الإشعارات داخل معاملة الرسالة.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MyConversationsController, VendorConversationsController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
