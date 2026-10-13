-- عملة التسوية يختارها البائع صراحةً قبل إرسال طلبه للمراجعة (UX-OPS-AUDIT البند 6).
-- كانت تُفرض من البلد بصمت ويثبّتها الاعتماد، وصفحة الاختيار لا يصلها رابط قبل الإرسال.
ALTER TABLE "vendors" ADD COLUMN "settlementCurrencyChosenAt" TIMESTAMPTZ;

-- من تجاوز التأهيل أو ثبّت عملته لا يُسأل ثانيةً. المتاجر في التأهيل (pending) تختار قبل الإرسال
UPDATE "vendors"
   SET "settlementCurrencyChosenAt" = COALESCE("settlementCurrencyLockedAt", "submittedAt", "createdAt")
 WHERE "status" <> 'pending' OR "settlementCurrencyLockedAt" IS NOT NULL;
