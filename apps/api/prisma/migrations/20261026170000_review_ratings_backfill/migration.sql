-- تقييم المنتج والمتجر من المراجعات المنشورة — BUY-070، 26 أكتوبر 2026.
--
-- كانت ratingAvg و ratingCount لا يحدّثها شيء: مراجعات منشورة ومتاجرها بتقييم 0 («تقييم المتجر»
-- مخفي في كل صفحة). الكود صار يحدّثها مع كل نشر وإخفاء؛ وهذا يحسب ما سبقه مرة واحدة.
-- الصفوف التي لا مراجعة لها ولا تقييم مسجَّل لا تُمسّ.
UPDATE "products" p SET
  "ratingAvg"   = COALESCE((SELECT ROUND(AVG(r."rating")::numeric, 2) FROM "reviews" r WHERE r."productId" = p."id" AND r."status" = 'published'), 0),
  "ratingCount" = (SELECT COUNT(*) FROM "reviews" r WHERE r."productId" = p."id" AND r."status" = 'published')
WHERE p."ratingCount" <> 0 OR EXISTS (SELECT 1 FROM "reviews" r WHERE r."productId" = p."id");

UPDATE "vendors" v SET
  "ratingAvg"   = COALESCE((SELECT ROUND(AVG(r."rating")::numeric, 2) FROM "reviews" r WHERE r."vendorId" = v."id" AND r."status" = 'published'), 0),
  "ratingCount" = (SELECT COUNT(*) FROM "reviews" r WHERE r."vendorId" = v."id" AND r."status" = 'published')
WHERE v."ratingCount" <> 0 OR EXISTS (SELECT 1 FROM "reviews" r WHERE r."vendorId" = v."id");
