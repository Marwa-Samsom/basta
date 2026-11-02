-- فرعي مدفوع بلا قيد بيع وله قيد شحن — CHK-029، 2 نوفمبر 2026
--
-- كوبون ثابت يموّله البائع بقيمة القطعة كلها (أو أكثر) يجعل قيد البيع صفراً، والدفتر لا يكتب
-- قيداً بصفر (ledger_amount_positive): يبقى قيد الشحن وحده. المنظران كانا يعرفان الفرعي المقيَّد
-- بقيد البيع وحده، فكان فرعي كهذا «طلب مدفوع بلا قيد بيع» في تنبيهات الإدارة كل يوم، وخارج فحص
-- حفظ المال كله. الآن قيد البيع أو الشحن — وفرعي لم يُقبض له شيء (القطعة مخصومة كلها والشحن
-- مجاني) لا قيد له بحقّ، فلا يُنبَّه عنه.

CREATE OR REPLACE VIEW "audit_money_conservation" AS
WITH vendor AS (
  SELECT "refId" AS sub_order_id,
         SUM(CASE WHEN "direction" = 'credit' THEN "amountMinorUnits" ELSE -"amountMinorUnits" END) AS net
  FROM "ledger_entries"
  WHERE "refType" = 'sub_order'
  GROUP BY "refId"
), platform AS (
  SELECT "subOrderId" AS sub_order_id,
         SUM(CASE WHEN "direction" = 'credit' THEN "amountMinorUnits" ELSE -"amountMinorUnits" END) AS net
  FROM "platform_ledger_entries"
  GROUP BY "subOrderId"
), refunded AS (
  SELECT "subOrderId" AS sub_order_id, SUM("vendorAmountMinorUnits") AS total
  FROM "refunds"
  WHERE "status" <> 'failed'
  GROUP BY "subOrderId"
)
SELECT
  s."id"                 AS sub_order_id,
  s."subOrderNumber",
  s."settlementCurrency" AS currency,
  s."totalMinorUnits"    AS collected,
  COALESCE(v.net, 0)     AS vendor_dues,
  COALESCE(p.net, 0)     AS platform_share,
  COALESCE(r.total, 0)   AS refunded
FROM "sub_orders" s
LEFT JOIN vendor   v ON v.sub_order_id = s."id"
LEFT JOIN platform p ON p.sub_order_id = s."id"
LEFT JOIN refunded r ON r.sub_order_id = s."id"
WHERE EXISTS (
    SELECT 1 FROM "ledger_entries" sale
    WHERE sale."refId" = s."id" AND sale."entryType" IN ('sale_credit', 'shipping_credit') AND sale."reversesEntryId" IS NULL
  )
  AND s."totalMinorUnits" <> COALESCE(v.net, 0) + COALESCE(p.net, 0) + COALESCE(r.total, 0);

CREATE OR REPLACE VIEW "audit_sub_order_without_ledger" AS
SELECT s."id" AS sub_order_id, s."subOrderNumber", s."placedAt"
FROM "sub_orders" s
WHERE s."placedAt" >= (SELECT ("valueJson" #>> '{}')::timestamptz FROM "settings" WHERE "key" = 'ledger_started_at')
  AND s."totalMinorUnits" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "ledger_entries" l
    WHERE l."refId" = s."id" AND l."entryType" IN ('sale_credit', 'shipping_credit') AND l."reversesEntryId" IS NULL
  );
