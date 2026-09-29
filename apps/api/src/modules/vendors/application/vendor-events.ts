import { Injectable, Logger } from '@nestjs/common';

type Listener = (vendorId: string) => Promise<void>;

/**
 * تغيّر ظهور متجر (اعتماد، تعليق، رفع تعليق) يهمّ وحدات فوق البائعين — الكتالوج
 * وفهرس بحثه. البائعون لا يعرفونها (هي تعتمد عليهم، ADR-002)، فيعلنون الحدث
 * هنا وتسجّل هي ما يلزمها عند إقلاعها.
 *
 * المستمع لا يُسقط طلب المدير: التعليق وقع في القاعدة، وفشل الفهرس يُسجَّل،
 * وقاعدة الرؤية في القراءة تحرس ما بقي فيه.
 */
@Injectable()
export class VendorEvents {
  private readonly logger = new Logger('VendorEvents');
  private readonly listeners: Listener[] = [];

  onVisibilityChanged(listener: Listener): void {
    this.listeners.push(listener);
  }

  async visibilityChanged(vendorId: string): Promise<void> {
    await Promise.all(
      this.listeners.map((listener) =>
        listener(vendorId).catch((err: unknown) => this.logger.error(`تعذّر تحديث ما يتبع المتجر ${vendorId}`, err as Error)),
      ),
    );
  }
}
