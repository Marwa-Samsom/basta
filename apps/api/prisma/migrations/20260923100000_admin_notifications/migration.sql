-- ============================================================================
-- المرحلة 11 — الإشعارات والإدارة
--
-- 1. القالب يحمل حالة تفعيله ومراجعته اللغوية: بوابة 11 تشترط أن يكون كل
--    قالب عربي مراجَعاً — والمراجعة حقل يُرى في الواجهة لا وعد في مستند.
-- 2. الإشعار صندوق صادر (outbox): يُدرَج في معاملة الحدث نفسه ثم يُرسل بعدها.
--    سقوط الخادم بين الحدث والإرسال لا يُضيّع إشعاراً — يبقى queued فيُرسل.
--    النص المصيَّر يُحفظ كما أُرسل: تعديل القالب غداً لا يغيّر ما وصل أمس.
-- ============================================================================

ALTER TABLE "notification_templates"
  ADD COLUMN "isEnabled"  BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN "reviewedAt" TIMESTAMPTZ,
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN "updatedBy"  UUID;

ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_channel_valid"
  CHECK ("channel" IN ('email', 'sms', 'whatsapp', 'push', 'in_app'));

ALTER TABLE "notifications"
  ADD COLUMN "recipient"   TEXT,
  ADD COLUMN "subject"     TEXT,
  ADD COLUMN "body"        TEXT,
  ADD COLUMN "attempts"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryRef" TEXT;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_status_valid"
  CHECK ("status" IN ('queued', 'sending', 'sent', 'failed', 'skipped'));

CREATE INDEX "notifications_queued_idx" ON "notifications"("createdAt") WHERE "status" = 'queued';

-- الصفحات والبانرات: من عدّلها ومتى
ALTER TABLE "cms_pages" ADD COLUMN "updatedBy" UUID;
ALTER TABLE "banners"
  ADD COLUMN "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN "updatedBy" UUID;

-- المراجعة المرفوضة تحمل سببها
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_status_valid" CHECK ("status" IN ('pending', 'published', 'rejected'));
