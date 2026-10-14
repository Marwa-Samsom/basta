-- ربط صورة المنتج بقيمة خيار (اللون الأحمر) — تظهر مع كل متغيّر يحملها.
-- كان الربط بمتغيّر واحد عند الرفع وحده (variantId)، فصورة «أحمر / S» لا تظهر لمن اختار
-- «أحمر / M»، ولا طريق لتغيير الربط بعد الرفع.
ALTER TABLE "product_images" ADD COLUMN "optionValueId" UUID;

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_optionValueId_fkey"
  FOREIGN KEY ("optionValueId") REFERENCES "attribute_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- لمتغيّر أو لقيمة أو للجميع — لا لاثنين معاً
ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_one_link" CHECK ("variantId" IS NULL OR "optionValueId" IS NULL);
