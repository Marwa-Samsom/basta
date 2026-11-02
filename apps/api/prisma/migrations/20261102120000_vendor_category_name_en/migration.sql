-- الاسم الإنجليزي لفئة المتجر — زرّ اللغة (2 نوفمبر 2026): «بدي كل اشي انجلزي».
-- اختياري: بلا قيمة يرى المشتري الاسم العربي. والفئات الثماني المقترحة تأخذ اسمها
-- الإنجليزي من النظام — للمتاجر الجديدة في دالة الزرع، وللقائمة هنا ما دام البائع لم يغيّر اسمها.

ALTER TABLE "vendor_categories" ADD COLUMN "nameEn" TEXT;

CREATE OR REPLACE FUNCTION "basta_seed_vendor_categories"(v UUID) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "vendor_categories" ("id", "vendorId", "nameAr", "nameEn", "sort", "updatedAt")
  SELECT gen_random_uuid(), v, t.name, t.name_en,
         COALESCE((SELECT max(c."sort") FROM "vendor_categories" c WHERE c."vendorId" = v), -1) + t.ord,
         CURRENT_TIMESTAMP
  FROM (VALUES
    (1, 'أزياء وملابس', 'Fashion & clothing'),
    (2, 'أحذية وحقائب', 'Shoes & bags'),
    (3, 'إلكترونيات', 'Electronics'),
    (4, 'المنزل والمطبخ', 'Home & kitchen'),
    (5, 'الجمال والعناية', 'Beauty & care'),
    (6, 'أطفال وألعاب', 'Kids & toys'),
    (7, 'رياضة وهوايات', 'Sports & hobbies'),
    (8, 'طعام ومنتجات محلية', 'Food & local products')
  ) AS t(ord, name, name_en)
  -- اسم موجود في المتجر (بأي حالة أو فراغ) لا يتكرّر — الفهرس الفريد نفسه
  WHERE NOT EXISTS (
    SELECT 1 FROM "vendor_categories" c
    WHERE c."vendorId" = v AND lower(btrim(c."nameAr")) = lower(btrim(t.name))
  );
$$;

UPDATE "vendor_categories" c
SET "nameEn" = t.name_en
FROM (VALUES
  ('أزياء وملابس', 'Fashion & clothing'),
  ('أحذية وحقائب', 'Shoes & bags'),
  ('إلكترونيات', 'Electronics'),
  ('المنزل والمطبخ', 'Home & kitchen'),
  ('الجمال والعناية', 'Beauty & care'),
  ('أطفال وألعاب', 'Kids & toys'),
  ('رياضة وهوايات', 'Sports & hobbies'),
  ('طعام ومنتجات محلية', 'Food & local products')
) AS t(name, name_en)
WHERE c."nameEn" IS NULL AND btrim(c."nameAr") = t.name;
