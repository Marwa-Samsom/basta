-- ============================================================================
-- سجل التدقيق يمنع حذف المستخدم بدل أن يحاول تعديله
--
-- كشفه اختبار التكامل: حذف مستخدم كان يفشل برسالة مشغّل ADR-005، لأن
-- `ON DELETE SET NULL` يُصدر UPDATE على audit_logs — وهو جدول للإضافة فقط.
--
-- المخطط كان يَعِد بسلوك ترفضه قاعدة البيانات. التصحيح أن يقول المخطط
-- الحقيقة: من له أثر في التدقيق لا يُحذف نهائياً. الحذف منطقي بـ deletedAt،
-- وحق المحو يُنفَّذ بتجهيل الحقول الشخصية مع إبقاء المعرّف — فتبقى سلامة
-- التدقيق وتزول البيانات الشخصية معاً.
-- ============================================================================

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actorUserId_fkey";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
