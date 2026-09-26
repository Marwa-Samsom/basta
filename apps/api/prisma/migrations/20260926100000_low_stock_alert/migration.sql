-- ============================================================================
-- تنبيه البائع بنفاد المخزون — SRS V-04 (دَين موثّق منذ المرحلة 05)
--
-- المخزون يرصد لحظة النزول إلى العتبة (lowStockSince) ولا يرسل. هذا العمود
-- يقول متى نُبِّه البائع لآخر مرة: الصف «معلَّق» ما دام lowStockSince أحدث
-- منه أو هو فارغ. النزول الثاني بعد تعبئة يُحدِّث lowStockSince فيُنبَّه ثانيةً.
--
-- ما كان منخفضاً قبل هذه المهاجرة يُعدّ منبَّهاً: وإلا وصل البائعين سيل
-- تنبيهات عن حالات قديمة يعرفونها من صفحة المخزون، لحظة النشر.
-- ============================================================================

ALTER TABLE "inventory" ADD COLUMN "lowStockNotifiedAt" TIMESTAMPTZ;

UPDATE "inventory" SET "lowStockNotifiedAt" = "lowStockSince" WHERE "lowStockSince" IS NOT NULL;

-- المعلَّق وحده يُمسح دورياً — فهرس جزئي على ما بلغ العتبة
CREATE INDEX "inventory_lowStockSince_idx" ON "inventory" ("lowStockSince") WHERE "lowStockSince" IS NOT NULL;
