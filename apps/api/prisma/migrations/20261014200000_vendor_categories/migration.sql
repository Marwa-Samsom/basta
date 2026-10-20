-- فئات المتجر بدل شجرة الفئات العامة — قرار صاحب المشروع 14 أكتوبر 2026:
--   «كل متجر له فئاته ومنتجاته بشكل منفصل، يُنشئها دون تدخّل الإدارة».
--   «عمولة المنصة نسبة على كل منتج يُباع بغضّ النظر عن فئته: عامة أو خاصة بالمتجر».
--
-- الترتيب: (1) الجدول الجديد، (2) نقل كل منتج إلى نسخة من فئته في متجره، (3) إنهاء
-- قواعد عمولة الفئات، (4) إسقاط الفئات العامة وكل ما يشير إليها.

-- ----------------------------------------------------------------------------
-- 1 · فئات المتجر
-- ----------------------------------------------------------------------------

CREATE TABLE "vendor_categories" (
  "id"        UUID        NOT NULL,
  "vendorId"  UUID        NOT NULL,
  "nameAr"    TEXT        NOT NULL,
  "sort"      INTEGER     NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "vendor_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_category_name_length" CHECK (char_length(btrim("nameAr")) BETWEEN 1 AND 80),
  CONSTRAINT "vendor_categories_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vendor_categories_id_vendorId_key" ON "vendor_categories"("id", "vendorId");
CREATE INDEX "vendor_categories_vendorId_sort_idx" ON "vendor_categories"("vendorId", "sort");
-- «ملابس» و «ملابس » و «ملابس» بحالة أخرى اسم واحد في المتجر الواحد
CREATE UNIQUE INDEX "vendor_categories_vendor_name_key" ON "vendor_categories"("vendorId", lower(btrim("nameAr")));

-- ----------------------------------------------------------------------------
-- 2 · المنتجات القائمة لا تفقد ترتيبها
--
-- كل متجر يأخذ نسخة باسم كل فئة عامة كانت منتجاته فيها، ويبقى كل منتج في نسخته.
-- فئتان عامتان بالاسم نفسه في فرعين تصيران فئة واحدة في المتجر.
-- ----------------------------------------------------------------------------

ALTER TABLE "products" ADD COLUMN "vendorCategoryId" UUID;

INSERT INTO "vendor_categories" ("id", "vendorId", "nameAr", "sort", "updatedAt")
SELECT gen_random_uuid(), x."vendorId", x."nameAr",
       (row_number() OVER (PARTITION BY x."vendorId" ORDER BY x."path"))::int - 1,
       CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (p."vendorId", lower(left(btrim(c."nameAr"), 80)))
         p."vendorId", left(btrim(c."nameAr"), 80) AS "nameAr", c."path"
  FROM "products" p
  JOIN "categories" c ON c."id" = p."categoryId"
  ORDER BY p."vendorId", lower(left(btrim(c."nameAr"), 80)), c."path"
) x;

UPDATE "products" p
SET "vendorCategoryId" = vc."id"
FROM "categories" c, "vendor_categories" vc
WHERE c."id" = p."categoryId"
  AND vc."vendorId" = p."vendorId"
  AND lower(btrim(vc."nameAr")) = lower(left(btrim(c."nameAr"), 80));

-- مركّب مع vendorId: منتج متجر لا يقع في فئة متجر آخر ولو كُتب الصف مباشرة
ALTER TABLE "products"
  ADD CONSTRAINT "products_vendorCategoryId_vendorId_fkey"
  FOREIGN KEY ("vendorCategoryId", "vendorId") REFERENCES "vendor_categories"("id", "vendorId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "products_vendorCategoryId_idx" ON "products"("vendorCategoryId");

-- ----------------------------------------------------------------------------
-- 3 · العمولة: للمتجر أو عامة — لا فئة
--
-- القواعد لا تُحذف (تفسير العمولات التاريخية)، فقواعد الفئات السارية تُنهى الآن.
-- كل طلب سابق على لقطة نسبته في order_items فلا يتغيّر شيء فيه. وسجلّ
-- commission.set في audit_logs يحفظ الفئة التي كانت لكل قاعدة.
-- ----------------------------------------------------------------------------

UPDATE "commission_rules"
SET "effectiveTo" = CURRENT_TIMESTAMP
WHERE "scope" = 'category'
  AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP);

ALTER TABLE "commission_rules" DROP CONSTRAINT "commission_rules_categoryId_fkey";
DROP INDEX "commission_rules_categoryId_idx";
ALTER TABLE "commission_rules" DROP COLUMN "categoryId";

-- لا قاعدة سارية إلا عامة أو لمتجر
ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_scope_live" CHECK ("scope" IN ('global', 'vendor') OR "effectiveTo" IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 4 · إسقاط الفئات العامة
-- ----------------------------------------------------------------------------

ALTER TABLE "products" DROP CONSTRAINT "products_categoryId_fkey";
DROP INDEX "products_categoryId_status_publishedAt_idx";
DROP INDEX "products_browse_active";
ALTER TABLE "products" DROP COLUMN "categoryId";

-- تصفّح الكتالوج — المنشور وحده، الأحدث أولاً (كان مفتاحه الفئة)
CREATE INDEX "products_browse_active"
  ON "products" ("publishedAt" DESC)
  WHERE "status" = 'active' AND "deletedAt" IS NULL;

ALTER TABLE "vendors" DROP CONSTRAINT "vendors_mainCategoryId_fkey";
DROP INDEX "vendors_mainCategoryId_idx";
ALTER TABLE "vendors" DROP COLUMN "mainCategoryId";

-- لافتات «أعلى صفحة الفئة» بلا صفحة تظهر فيها — تُطفأ ولا تُحذف
UPDATE "banners" SET "isActive" = false WHERE "placement" = 'category_top';

DROP TABLE "category_attributes";
DROP TABLE "categories";
