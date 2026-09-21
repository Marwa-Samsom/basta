import { defineConfig } from '@playwright/test';

/**
 * اختبارات E2E — المرحلة 12: مسارا الشراء والتسوية كاملين في متصفّح حقيقي.
 *
 * تعمل على خادمين قائمين (الـ API على 4000 والواجهة على E2E_BASE_URL، افتراضياً
 * بناء الإنتاج على 3100) وChrome المثبّت على الجهاز — لا تنزيل متصفّح.
 *
 *   npm run build:probe -w @basta/web && npm run serve:probe -w @basta/web
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3100',
    channel: 'chrome',
    headless: true,
    locale: 'ar',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
