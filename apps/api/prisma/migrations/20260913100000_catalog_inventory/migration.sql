-- ============================================================================
-- المرحلة 05 — الكتالوج والمخزون: المخطط يقول الحقيقة
--
-- ثلاثة وعود في المخطط كانت تخالف ما تفرضه القاعدة أو ما يعِد به ERD:
--
-- 1. حذف متغيّر «يتسلسل» إلى inventory_movements. لكن مشغّل الجملة من
--    ADR-005 يرفض أي DELETE على الحركات، فكل حذف لمتغيّر ذي تاريخ كان
--    سيفشل برسالة الدفتر. الدرس 4 نفسه: المتغيّر لا يُحذف بل يُؤرشف،
--    والمفتاح الأجنبي يقول ذلك صراحةً بـ RESTRICT.
--
-- 2. SKU كان فريداً لكل منتج، و ERD يقول لكل بائع. الاستيراد يطابق بـ SKU،
--    فتكراره عند البائع نفسه يجعل التحديث يصيب منتجاً غير المقصود.
--
-- 3. لا شيء كان يمنع متغيّرين بالتركيبة نفسها (أحمر/M مرتين) — SRS V-02.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · البائع على المتغيّر، مقيَّداً بمفتاح مركّب فلا يخالف بائع المنتج
-- ----------------------------------------------------------------------------

ALTER TABLE "product_variants" ADD COLUMN "vendorId" UUID;
UPDATE "product_variants" v SET "vendorId" = p."vendorId" FROM "products" p WHERE p."id" = v."productId";
ALTER TABLE "product_variants" ALTER COLUMN "vendorId" SET NOT NULL;

ALTER TABLE "product_variants" ADD COLUMN "optionsKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "product_variants" ADD COLUMN "archivedAt" TIMESTAMPTZ;

CREATE UNIQUE INDEX "products_id_vendorId_key" ON "products"("id", "vendorId");

ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_productId_fkey";
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_productId_vendorId_fkey"
  FOREIGN KEY ("productId", "vendorId") REFERENCES "products"("id", "vendorId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 2 · التفرّد على الحيّ فقط — الأرشفة تحرّر SKU والتركيبة
-- ----------------------------------------------------------------------------

DROP INDEX "product_variants_productId_sku_key";

CREATE UNIQUE INDEX "product_variants_vendor_sku_live"
  ON "product_variants" ("vendorId", "sku") WHERE "archivedAt" IS NULL;

CREATE UNIQUE INDEX "product_variants_options_live"
  ON "product_variants" ("productId", "optionsKey") WHERE "archivedAt" IS NULL;

ALTER TABLE "product_variants"
  ADD CONSTRAINT "variant_price_positive" CHECK ("priceMinorUnits" > 0),
  ADD CONSTRAINT "variant_compare_at_above_price"
    CHECK ("compareAtPriceMinorUnits" IS NULL OR "compareAtPriceMinorUnits" > "priceMinorUnits"),
  ADD CONSTRAINT "variant_dimensions_non_negative"
    CHECK (COALESCE("weightGrams", 0) >= 0 AND COALESCE("lengthMm", 0) >= 0
       AND COALESCE("widthMm", 0) >= 0 AND COALESCE("heightMm", 0) >= 0),
  ADD CONSTRAINT "variant_sku_not_blank" CHECK (length(btrim("sku")) > 0);

-- ----------------------------------------------------------------------------
-- 3 · التاريخ لا يُمحى بالتسلسل — RESTRICT بدل CASCADE
-- ----------------------------------------------------------------------------

ALTER TABLE "inventory" DROP CONSTRAINT "inventory_variantId_fkey";
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_variantId_fkey" FOREIGN KEY ("variantId")
  REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_variantId_fkey";
ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_variantId_fkey" FOREIGN KEY ("variantId")
  REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_variantId_fkey";
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_variantId_fkey" FOREIGN KEY ("variantId")
  REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 4 · المخزون: رصد العتبة، وحركة بلا سبب معروف أو بلا أثر مرفوضة
-- ----------------------------------------------------------------------------

ALTER TABLE "inventory" ADD COLUMN "lowStockSince" TIMESTAMPTZ;
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_low_stock_threshold_non_negative" CHECK ("lowStockThreshold" >= 0);

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "movement_delta_non_zero" CHECK ("delta" <> 0),
  ADD CONSTRAINT "movement_reason_valid"
    CHECK ("reason" IN ('sale', 'return', 'cancel', 'manual_adjust', 'import', 'damage'));

-- ----------------------------------------------------------------------------
-- 5 · الفئات والسمات
-- ----------------------------------------------------------------------------

-- المسار المادّي هو هوية موقع الفئة في الشجرة: تكراره يخلط فرعين في LIKE واحد
DROP INDEX "categories_path_idx";
CREATE UNIQUE INDEX "categories_path_key" ON "categories"("path");
-- الفهرس الفريد العادي لا يخدم LIKE 'بادئة%' خارج ترتيب C — هذا يخدمه
CREATE INDEX "categories_path_prefix" ON "categories" ("path" text_pattern_ops);

ALTER TABLE "categories" ADD CONSTRAINT "category_depth_non_negative" CHECK ("depth" >= 0);

ALTER TABLE "attributes"
  ADD CONSTRAINT "attribute_input_type_valid"
  CHECK ("inputType" IN ('select', 'multiselect', 'number', 'text', 'boolean'));

-- ----------------------------------------------------------------------------
-- 6 · ثنائية اللغة لكل ما يراه المشتري
-- ----------------------------------------------------------------------------

ALTER TABLE "product_attribute_values" ADD COLUMN "valueTextEn" TEXT;
ALTER TABLE "product_images" ADD COLUMN "altEn" TEXT;
