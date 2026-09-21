import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../../common/config/env';

/**
 * عميل Meilisearch — طبقة رقيقة فوق HTTP.
 *
 * لم تُضَف مكتبة عميل: الاستعمال هنا ستة مسارات، والمكتبة تعني اعتمادية
 * إضافية تُرقَّى وتُدقَّق مقابل ما نكتبه في ثمانين سطراً.
 *
 * **كل نداء له مهلة.** محرّك بحث بطيء لا يجوز أن يعلّق طلب المتجر: الصفحة
 * التي لا تُعرض أسوأ من نتيجة بحث تأتي من قاعدة البيانات.
 */
@Injectable()
export class MeiliClient {
  private readonly logger = new Logger('Meili');

  private get base(): string {
    return loadEnv().meiliUrl.replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    const key = loadEnv().meiliKey;
    return {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    };
  }

  get index(): string {
    return loadEnv().meiliIndex;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = 1500,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Meilisearch ${method} ${path} → ${res.status} ${await res.text()}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** هل المحرّك حيّ الآن؟ يُستعمل لاتخاذ قرار السقوط إلى قاعدة البيانات. */
  async isUp(): Promise<boolean> {
    try {
      const health = await this.request<{ status: string }>('GET', '/health', undefined, 700);
      return health.status === 'available';
    } catch (err) {
      this.logger.warn(`محرّك البحث غير متاح: ${(err as Error).message}`);
      return false;
    }
  }
}
