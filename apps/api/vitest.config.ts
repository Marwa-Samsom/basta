import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * esbuild — محوّل vitest الافتراضي — لا يُصدر بيانات المزخرفات الوصفية، فحقن
   * Nest بأنواع المُنشئ يصل undefined (Reflector في الحارس العام). SWC يُصدرها
   * كما يُصدرها tsc في البناء: التطبيق في الاختبار هو التطبيق في الخادم.
   */
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    // ملفات الاختبار تدخل عشرات المرات من العنوان نفسه؛ حدّ التخمين الحقيقي
    // يُختبر في security.integration.spec.ts بقيمته الفعلية
    env: { THROTTLE_AUTH_LIMIT: '100000', THROTTLE_DEFAULT_LIMIT: '100000' },
    include: ['src/**/*.spec.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**/*.ts'] },
  },
});
