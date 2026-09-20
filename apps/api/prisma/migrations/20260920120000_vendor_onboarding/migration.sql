-- ============================================================================
-- المرحلة 06 — تأهيل البائع: الحالة تُخزَّن لا تُشتقّ
--
-- كانت VendorStatus أربع حالات، وشاشة VD-03 تحتاج ستاً. «سجّل ولم يرسل»
-- و «أرسل وينتظر» و «رُفض فعليه الإصلاح» ثلاث حالات مختلفة لصاحبها وللإدارة،
-- وتخزينها في `pending` واحدة يعني أن كل استعلام يعيد اشتقاقها من تاريخ
-- فارغ أو سبب رفض غير فارغ — وأول موضع يُغفل الاشتقاق يصير خطأ صامتاً
-- (الدرس 4: المخطط يجب أن يقول الحقيقة).
--
-- ووثائق البائع ليست صور منتجات: فيها هوية شخصية وسجل تجاري. تُخزَّن في
-- مخزن خاص لا في uploads العام، والمخطط يوثّق ذلك على العمود نفسه.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · حالتان جديدتان في دورة حياة البائع
-- ----------------------------------------------------------------------------
-- ALTER TYPE ... ADD VALUE لا يصلح داخل معاملة في PostgreSQL، وإعادة بناء
-- النوع تتطلب إسقاط الافتراضي أولاً وإعادته بعد التبديل.

ALTER TABLE "vendors" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "VendorStatus" RENAME TO "VendorStatus_old";

CREATE TYPE "VendorStatus" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'suspended', 'banned');

ALTER TABLE "vendors"
  ALTER COLUMN "status" TYPE "VendorStatus" USING "status"::text::"VendorStatus";

ALTER TABLE "vendors" ALTER COLUMN "status" SET DEFAULT 'pending';

DROP TYPE "VendorStatus_old";

-- ----------------------------------------------------------------------------
-- 2 · تواريخ دورة الحياة، وتثبيت عملة التسوية (ADR-013)
-- ----------------------------------------------------------------------------

ALTER TABLE "vendors"
  ADD COLUMN "settlementCurrencyLockedAt" TIMESTAMPTZ,
  ADD COLUMN "businessType"   TEXT,
  ADD COLUMN "mainCategoryId" UUID,
  ADD COLUMN "submittedAt"    TIMESTAMPTZ,
  ADD COLUMN "rejectedAt"     TIMESTAMPTZ,
  ADD COLUMN "suspendedAt"    TIMESTAMPTZ;

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_businessType_check"
  CHECK ("businessType" IS NULL OR "businessType" IN ('individual', 'company'));

-- الفئة الرئيسية للمتجر تُستعمل في فرز طابور المراجعة، فحذف فئة مستعمَلة يُمنع
ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_mainCategoryId_fkey"
  FOREIGN KEY ("mainCategoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "vendors_mainCategoryId_idx" ON "vendors"("mainCategoryId");

-- طابور المراجعة يقرأ الأقدم أولاً: فهرس جزئي على المرسَل وحده
CREATE INDEX "vendors_review_queue_idx"
  ON "vendors"("submittedAt")
  WHERE "status" = 'in_review';

-- سبب الرفض ليس تجميلاً: يُعرض للبائع كما كتبه المراجع، فلا يكون فارغاً
ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_rejection_reason_check"
  CHECK ("status" <> 'rejected' OR (COALESCE(BTRIM("rejectionReason"), '') <> ''));

-- المعتمَد له لحظة اعتماد. أما **من** اعتمد فيبقى قابلاً للفراغ عمداً:
-- الاعتماد اليدوي يملأه دائماً (الخدمة تفرضه)، والصفوف المهاجَرة أو المولَّدة
-- آلياً لا تملك مراجعاً حقيقياً — وملء العمود باسم لم يراجع أسوأ من فراغه.
-- سجل التدقيق هو المرجع في «من فعل ماذا».
UPDATE "vendors"
   SET "approvedAt" = COALESCE("approvedAt", "createdAt")
 WHERE "status" = 'approved';

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_approved_stamp_check"
  CHECK ("status" <> 'approved' OR "approvedAt" IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 3 · الوثائق: نوع معروف، حالة معروفة، ووثيقة واحدة فعّالة لكل نوع
-- ----------------------------------------------------------------------------

ALTER TABLE "vendor_documents"
  ADD COLUMN "mimeType"     TEXT,
  ADD COLUMN "sizeBytes"    INTEGER,
  ADD COLUMN "originalName" TEXT,
  ADD COLUMN "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- الصفوف القائمة (إن وُجدت) تُملأ بقيم صادقة قبل فرض NOT NULL
UPDATE "vendor_documents"
   SET "mimeType" = COALESCE("mimeType", 'application/pdf'),
       "sizeBytes" = COALESCE("sizeBytes", 0);

ALTER TABLE "vendor_documents"
  ALTER COLUMN "mimeType"  SET NOT NULL,
  ALTER COLUMN "sizeBytes" SET NOT NULL;

ALTER TABLE "vendor_documents"
  ADD CONSTRAINT "vendor_documents_type_check"
  CHECK ("type" IN ('commercial_register', 'national_id', 'tax_card', 'bank_proof'));

ALTER TABLE "vendor_documents"
  ADD CONSTRAINT "vendor_documents_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'rejected'));

ALTER TABLE "vendor_documents"
  ADD CONSTRAINT "vendor_documents_reject_reason_check"
  CHECK ("status" <> 'rejected' OR (COALESCE(BTRIM("rejectReason"), '') <> ''));

ALTER TABLE "vendor_documents"
  ADD CONSTRAINT "vendor_documents_size_check"
  CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760);

ALTER TABLE "vendor_documents"
  ADD CONSTRAINT "vendor_documents_mime_check"
  CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png'));

-- إعادة الرفع تستبدل الوثيقة ولا تكدّس نسخاً يختار المراجع بينها
DELETE FROM "vendor_documents" a
  USING "vendor_documents" b
 WHERE a."vendorId" = b."vendorId"
   AND a."type" = b."type"
   AND a."createdAt" < b."createdAt";

ALTER TABLE "vendor_documents"
  ADD CONSTRAINT "vendor_documents_vendorId_type_key" UNIQUE ("vendorId", "type");

-- ----------------------------------------------------------------------------
-- 4 · الحساب البنكي: آيبان مطبَّع بلا فراغات، وواحد افتراضي لكل بائع
-- ----------------------------------------------------------------------------

ALTER TABLE "vendor_bank_accounts"
  ADD CONSTRAINT "vendor_bank_accounts_iban_check"
  CHECK ("iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$');

CREATE UNIQUE INDEX "vendor_bank_accounts_default_one"
  ON "vendor_bank_accounts"("vendorId")
  WHERE "isDefault" = TRUE;
