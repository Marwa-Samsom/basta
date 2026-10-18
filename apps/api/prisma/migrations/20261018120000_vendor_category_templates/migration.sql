-- الفئات الثماني المقترحة لكل متجر — قرار صاحبة المشروع 18 أكتوبر 2026:
--   «ما ينضاف أي منتج بدون ما يتصنّف، وبدي يكون في 8 فئات مقترحة من النظام».
--
-- قوالب لا شجرة عامة: كل متجر يبدأ بها في فئاته (vendor_categories) ويعدّلها أو
-- يحذفها أو يضيف عليها، والمشتري يراها في صفحة المتجر وحدها — ADR-015 قائم.
-- والفئة صارت إلزامية للمنتج في الخادم (catalog/application/product.service.ts)؛
-- المنتجات القائمة بلا فئة تبقى ظاهرة وتُطلب فئتها عند أوّل تعديل أو نشر.
--
-- الزرع في القاعدة لا في الكود: المتجر يُنشأ في وحدة vendors والفئات في catalog،
-- والمشغِّل يغطّي كل طريق إنشاء (التسجيل، السكربتات، الاختبارات) بلا اعتماد بين الوحدتين.

CREATE OR REPLACE FUNCTION "basta_seed_vendor_categories"(v UUID) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "vendor_categories" ("id", "vendorId", "nameAr", "sort", "updatedAt")
  SELECT gen_random_uuid(), v, t.name,
         COALESCE((SELECT max(c."sort") FROM "vendor_categories" c WHERE c."vendorId" = v), -1) + t.ord,
         CURRENT_TIMESTAMP
  FROM (VALUES
    (1, 'أزياء وملابس'),
    (2, 'أحذية وحقائب'),
    (3, 'إلكترونيات'),
    (4, 'المنزل والمطبخ'),
    (5, 'الجمال والعناية'),
    (6, 'أطفال وألعاب'),
    (7, 'رياضة وهوايات'),
    (8, 'طعام ومنتجات محلية')
  ) AS t(ord, name)
  -- اسم موجود في المتجر (بأي حالة أو فراغ) لا يتكرّر — الفهرس الفريد نفسه
  WHERE NOT EXISTS (
    SELECT 1 FROM "vendor_categories" c
    WHERE c."vendorId" = v AND lower(btrim(c."nameAr")) = lower(btrim(t.name))
  );
$$;

CREATE OR REPLACE FUNCTION "basta_vendor_categories_on_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "basta_seed_vendor_categories"(NEW."id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vendors_seed_categories"
AFTER INSERT ON "vendors"
FOR EACH ROW EXECUTE FUNCTION "basta_vendor_categories_on_insert"();

-- المتاجر القائمة تأخذ ما ينقصها من الثماني بعد فئاتها
SELECT "basta_seed_vendor_categories"("id") FROM "vendors";
