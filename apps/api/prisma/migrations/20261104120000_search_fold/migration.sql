-- توحيد الحروف للبحث (4 نوفمبر 2026): «الايقاف» تجد «الإيقاف»، و«ساعه» تجد «ساعة».
-- كانت كل خانة بحث تقارن الحروف كما كُتبت. الدالة نسخة من fold() في src/common/arabic-fold.ts
-- (تُولَّد منها هذه المهاجرة، واختبار التكامل يقارنهما): تحذف التطويل والتشكيل والألف الخنجرية
-- والهمزة المفردة، وتبدّل أ إ آ ٱ ← ا، ى ← ي، ة ← ه، ؤ ← و، ئ ← ي، ی ← ي، ک ← ك، والأرقام
-- الهندية والفارسية ← 0-9، ثم تصغّر اللاتيني.
CREATE OR REPLACE FUNCTION basta_fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $fn$ SELECT lower(translate(regexp_replace(t, '[' || chr(1600) || chr(1611) || '-' || chr(1618) || chr(1648) || chr(1569) || ']', '', 'g'), 'أإآٱىةؤئیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'اااايهوييك01234567890123456789')) $fn$;

-- لكل نصّ عربي يُبحث فيه عمود موحَّد مولَّد: يحسبه Postgres عند كل كتابة، ولا يكتبه الكود أبداً
ALTER TABLE "products" ADD COLUMN "nameArFold" TEXT GENERATED ALWAYS AS (basta_fold("nameAr")) STORED;
ALTER TABLE "products" ADD COLUMN "descriptionArFold" TEXT GENERATED ALWAYS AS (basta_fold("descriptionAr")) STORED;
ALTER TABLE "vendors" ADD COLUMN "nameArFold" TEXT GENERATED ALWAYS AS (basta_fold("nameAr")) STORED;
ALTER TABLE "users" ADD COLUMN "fullNameFold" TEXT GENERATED ALWAYS AS (basta_fold("fullName")) STORED;
ALTER TABLE "campaigns" ADD COLUMN "nameArFold" TEXT GENERATED ALWAYS AS (basta_fold("nameAr")) STORED;
ALTER TABLE "attributes" ADD COLUMN "nameArFold" TEXT GENERATED ALWAYS AS (basta_fold("nameAr")) STORED;
ALTER TABLE "cms_pages" ADD COLUMN "titleArFold" TEXT GENERATED ALWAYS AS (basta_fold("titleAr")) STORED;
ALTER TABLE "banners" ADD COLUMN "titleArFold" TEXT GENERATED ALWAYS AS (basta_fold("titleAr")) STORED;
ALTER TABLE "reviews" ADD COLUMN "titleFold" TEXT GENERATED ALWAYS AS (basta_fold("title")) STORED;
ALTER TABLE "reviews" ADD COLUMN "bodyFold" TEXT GENERATED ALWAYS AS (basta_fold("body")) STORED;
ALTER TABLE "order_items" ADD COLUMN "productNameSnapshotArFold" TEXT GENERATED ALWAYS AS (basta_fold("productNameSnapshotAr")) STORED;
ALTER TABLE "conversations" ADD COLUMN "lastPreviewFold" TEXT GENERATED ALWAYS AS (basta_fold("lastPreview")) STORED;
ALTER TABLE "orders" ADD COLUMN "recipientNameFold" TEXT GENERATED ALWAYS AS (basta_fold(("shippingAddressSnapshot" ->> 'recipientName'))) STORED;
