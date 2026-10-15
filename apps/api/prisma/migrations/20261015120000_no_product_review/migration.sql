-- لا مراجعة للمنتجات — قرار صاحب المشروع 15 أكتوبر 2026 (يلغي Q-15 و Q-16):
--   «لازم المنتجات تنزل على حساب الزبون من دون مراجعة الإدارة. شيل مراجعة المنتجات كلها».
-- البائع ينشر فيظهر المنتج فوراً — أو فور اعتماد متجره إن نشر وهو قيد المراجعة
-- (قاعدة الرؤية تشترط بائعاً معتمداً، فلا يلزم شيء هنا لذلك).

-- 1 · ما ينتظر المراجعة الآن يُنشر — تاريخ نشره الأول إن كان، وإلا الآن
UPDATE "products"
SET "status" = 'active', "publishedAt" = COALESCE("publishedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'pending_review';

-- 2 · الحالة pending_review تسقط من النوع — المخطط يقول الحقيقة. الفهرسان الجزئيان
-- يشيران إلى النوع القديم في شرطهما، فيُسقطان ويُعاد الحيّ منهما
DROP INDEX "products_review_queue_idx";
DROP INDEX "products_browse_active";

ALTER TYPE "ProductStatus" RENAME TO "ProductStatus_old";
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'active', 'rejected', 'archived');
ALTER TABLE "products" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "status" TYPE "ProductStatus" USING "status"::text::"ProductStatus";
ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "ProductStatus_old";

CREATE INDEX "products_browse_active"
  ON "products" ("publishedAt" DESC)
  WHERE "status" = 'active' AND "deletedAt" IS NULL;

-- 3 · نسخة المحتوى كانت شرط اعتماد المراجِع (لا يُعتمد غير ما قرأه) — لا اعتماد بعد اليوم
ALTER TABLE "products" DROP COLUMN "contentRevision";

-- 4 · «رفض منتج» صار «إيقاف منتج»: الإدارة توقف منشوراً مخالفاً بسبب، والبائع يعدّله وينشره.
-- يُستبدل النصّ الافتراضي القديم وحده — ما حرّرته الإدارة يبقى كما كتبته
UPDATE "notification_templates"
SET "subject" = 'أوقفنا عرض «{{product_name}}»',
    "body" = E'فريق {{store_name}}،\n\nأوقفنا عرض المنتج «{{product_name}}» في المتجر. السبب: {{reason}}.\n\nعدّلوه ثم انشروه من جديد: {{link}}\n\nبسطة'
WHERE "code" = 'product_rejected' AND "channel" = 'email'
  AND "body" = E'فريق {{store_name}}،\n\nلم ننشر المنتج «{{product_name}}». السبب: {{reason}}.\n\nعدّلوه وأعيدوا إرساله للمراجعة: {{link}}\n\nبسطة';

UPDATE "notification_templates"
SET "body" = 'أُوقف عرض «{{product_name}}»: {{reason}}.'
WHERE "code" = 'product_rejected' AND "channel" = 'in_app'
  AND "body" = 'لم يُنشر «{{product_name}}»: {{reason}}.';
