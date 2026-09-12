/**
 * المراقبة — موصولة قبل كتابة أول ميزة، لا بعد أول عطل.
 *
 * بلا SENTRY_DSN تصير كل الدوال هنا عمليات فارغة، فالتطبيق يعمل محلياً
 * بلا حساب ولا مفتاح. توصيل المفتاح لاحقاً لا يتطلب تعديل سطر واحد.
 */
import * as Sentry from '@sentry/nestjs';

let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.GIT_SHA ?? 'dev',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    /**
     * لا تُرسَل الأسرار ولا بيانات الدفع إلى طرف ثالث.
     * حادثة يُفهم سببها بلا رقم بطاقة أفضل من حادثة تُفهم بتسريب.
     */
    beforeSend(event) {
      if (event.request?.headers) {
        for (const h of ['authorization', 'cookie', 'x-api-key']) {
          delete event.request.headers[h];
        }
      }
      if (event.request?.data && typeof event.request.data === 'object') {
        const data = event.request.data as Record<string, unknown>;
        for (const k of ['password', 'passwordHash', 'cardNumber', 'cvv', 'totpSecret', 'iban']) {
          if (k in data) data[k] = '[محذوف]';
        }
      }
      return event;
    },
  });

  enabled = true;
}

export const isSentryEnabled = (): boolean => enabled;

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext('basta', context);
    Sentry.captureException(error);
  });
}

/** المسارات المالية تُعلَّم صراحةً — تنبيهها لا يُخلط بخطأ واجهة. */
export function captureFinancialError(error: unknown, context: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setLevel('fatal');
    scope.setTag('domain', 'finance');
    scope.setContext('basta', context);
    Sentry.captureException(error);
  });
}
