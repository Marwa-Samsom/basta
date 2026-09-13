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
    include: ['src/**/*.spec.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**/*.ts'] },
  },
});
