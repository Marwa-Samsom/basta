import { describe, expect, it } from 'vitest';
import { isTestEmail } from './test-users';

/**
 * التنظيف قبل كل تشغيل يمحو صلاحيات الإدارة ورسائلها المعلّقة لمستخدمي الاختبار — على قاعدة
 * يُجرَّب عليها يدوياً. حساب يُخطئه النمط يفقد مديرُه صلاحياته عند كل `npm test`.
 */
describe('مستخدمو الاختبار — ما يمسّه التنظيف وما لا يمسّه', () => {
  it('حسابات التجربة اليدوية خارجه', () => {
    for (const email of [
      'admin@basta.test',
      'buyer1@basta.test',
      'vendor2@basta.test',
      'vendor3@basta.test',
      'marwamaged@gmail.com',
      'demo-vendor@basta.local',
      'admin.k3f9@basta.local',
      'admin.k3f9@basta.test.example.com',
    ]) {
      expect(isTestEmail(email), email).toBe(false);
    }
  });

  it('حسابات الاختبارات و E2E داخله، بأي حالة أحرف', () => {
    for (const email of ['admin.k3f9@basta.test', 'buyer.1792338019@basta.test', 'owner.a.b@basta.test', 'Mixed.X@Basta.test']) {
      expect(isTestEmail(email), email).toBe(true);
    }
  });
});
