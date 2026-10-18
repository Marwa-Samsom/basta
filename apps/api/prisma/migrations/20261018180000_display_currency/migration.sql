-- عملة العرض — قرار صاحبة المشروع 18 أكتوبر 2026: المشتري يختار عملة واحدة يرى
-- بها الأسعار في الموقع كله ويدفع بها، والإدارة تحدّد عملة الزائر الجديد.
--
-- المحرّك يحوّل منذ ADR-013 (السلة بعملة الدفع، والفرعي بلقطة صرفه)؛ الجديد هنا
-- تفضيل المستخدم المسجَّل كي يتبعه بين أجهزته، والعملة الافتراضية إعداداً.

ALTER TABLE "users" ADD COLUMN "preferredCurrency" CHAR(3);

INSERT INTO "settings" ("key", "valueJson", "updatedAt")
VALUES ('default_display_currency', '"JOD"', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
