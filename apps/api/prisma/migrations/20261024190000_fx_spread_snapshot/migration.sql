-- هامش الصرف لحظة التسعير على كل فرعي (ACFG-093، 24 أكتوبر 2026). كان «دخل فرق الصرف»
-- يقسم chargeTotal على (10000 + fx_spread_bps الحالي)، فتغيير الهامش اليوم يعيد كتابة دخل
-- الصرف التاريخي كله — ضبطه 0 كان يُصفّره. fxRateSnapshot عامل واحد يضمّ الهامش، فلا يُشتقّ منه.
ALTER TABLE "sub_orders" ADD COLUMN "fxSpreadBpsSnapshot" INTEGER;

-- الفرعيات السابقة: صفر بعملة واحدة، وإلا الهامش النافذ لحظة الطلب من سجلّ التدقيق
-- (setting.update يحفظ القيمة قبل وبعد): آخر تغيير قبله، أو «قبل» أول تغيير بعده، أو الإعداد
-- الحالي إن لم يتغيّر قطّ، أو 200 (افتراض التسعير) إن لم يُضبط.
UPDATE "sub_orders" s
SET "fxSpreadBpsSnapshot" = CASE
  WHEN s."settlementCurrency" = o."currency" THEN 0
  ELSE COALESCE(
    (SELECT (a."afterJson" ->> 'value')::int FROM "audit_logs" a
      WHERE a."action" = 'setting.update' AND a."entityId" = 'fx_spread_bps' AND a."createdAt" <= s."placedAt"
      ORDER BY a."createdAt" DESC LIMIT 1),
    (SELECT (a."beforeJson" ->> 'value')::int FROM "audit_logs" a
      WHERE a."action" = 'setting.update' AND a."entityId" = 'fx_spread_bps' AND a."createdAt" > s."placedAt"
      ORDER BY a."createdAt" ASC LIMIT 1),
    (SELECT ("valueJson" #>> '{}')::int FROM "settings" WHERE "key" = 'fx_spread_bps'),
    200)
END
FROM "orders" o
WHERE o."id" = s."orderId";
