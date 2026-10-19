import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { testEnv } from './test/test-env';

export default defineConfig({
  /**
   * esbuild — محوّل vitest الافتراضي — لا يُصدر بيانات المزخرفات الوصفية، فحقن
   * Nest بأنواع المُنشئ يصل undefined (Reflector في الحارس العام). SWC يُصدرها
   * كما يُصدرها tsc في البناء: التطبيق في الاختبار هو التطبيق في الخادم.
   */
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    env: {
      // ملفات الاختبار تدخل عشرات المرات من العنوان نفسه؛ حدّ التخمين الحقيقي
      // يُختبر في security.integration.spec.ts بقيمته الفعلية
      // ورمز التطوير الثابت مطفأ: الاختبارات تثبت الرموز الحقيقية ولو كان مفعَّلاً في .env
      THROTTLE_AUTH_LIMIT: '100000',
      THROTTLE_DEFAULT_LIMIT: '100000',
      DEV_FIXED_CODE: '',
      // قاعدة وفهرس ومجلدات منفصلة عن بيئة التطوير — test/test-env.ts
      ...testEnv(process.env),
    },
    globalSetup: ['./test/prepare-db.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**/*.ts'] },
  },
});
