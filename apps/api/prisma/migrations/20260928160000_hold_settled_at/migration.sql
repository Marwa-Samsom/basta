-- ============================================================================
-- تحرير الأرصدة لا يتجوّع
--
-- المهمة تأخذ أقدم 500 فرعي «مستحق» — له قيد بيع وليس له hold_release_out.
-- الفرعي المسترَدّ كله صافي معلّقه صفر: release لا يكتب شيئاً فيبقى مستحقاً
-- إلى الأبد، ويعود في كل دورة. متى تراكم منها 500 احتلّت الدفعة كلها، فلا
-- يُحرَّر رصيد أي بائع بعدها.
--
-- holdSettledAt يُكتب حين يُحسم التحرير — نُقل المال أو لم يبقَ ما يُنقل —
-- والمهمة لا ترى إلا ما لم يُحسم.
-- ============================================================================

ALTER TABLE "sub_orders" ADD COLUMN "holdSettledAt" TIMESTAMPTZ;

-- ما حُرِّر من قبل محسوم بوقت قيد تحريره
UPDATE "sub_orders" s
   SET "holdSettledAt" = e."createdAt"
  FROM "ledger_entries" e
 WHERE e."refType" = 'sub_order' AND e."refId" = s."id"
   AND e."entryType" = 'hold_release_out' AND e."reversesEntryId" IS NULL
   AND s."holdSettledAt" IS NULL;

-- طابور التحرير: ما له موعد ولم يُحسم — صغير مهما كبر الجدول
CREATE INDEX "sub_orders_hold_due_idx" ON "sub_orders" ("holdReleaseAt")
  WHERE "holdSettledAt" IS NULL AND "holdReleaseAt" IS NOT NULL;
