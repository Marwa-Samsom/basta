/**
 * من هو مستخدم الاختبار. كل ملف ينشئ حساباته «وسم.لاحقة@basta.test» (admin.k3f9@basta.test،
 * و E2E بالنمط نفسه)، وحسابات التجربة اليدوية بلا نقطة قبل @ (admin@basta.test و buyer1@basta.test
 * و vendor2@basta.test) أو خارج basta.test كلياً. ما يُنظَّف قبل كل تشغيل يمسّ الأولى وحدها.
 *
 * صيغة POSIX يقرؤها PostgreSQL (`~*`) و JavaScript معاً.
 */
export const TEST_EMAIL_PATTERN = String.raw`^[^@]+\.[^@]+@basta\.test$`;

export const isTestEmail = (email: string): boolean => new RegExp(TEST_EMAIL_PATTERN, 'i').test(email);
