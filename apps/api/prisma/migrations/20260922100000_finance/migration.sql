-- ============================================================================
-- المرحلة 10 — المال: دفتر المنصة، وقيمة الاسترداد بعملة البائع، ومنظر الحفظ
--
-- بوابة المرحلة الأولى: عمولة المنصة + مستحقات البائعين + الاستردادات
-- = المقبوض، بالقرش. لتكون المساواة فحصاً لا تحصيل حاصل يُسجَّل كل طرف
-- **مستقلاً**: البائع في ledger_entries، والمنصة في platform_ledger_entries،
-- والمشتري في refunds. المنظر يجمع الثلاثة ويقارنها بما دُفع، لكل فرعي
-- وبعملة بائعه (ADR-013: لا يُجمع مبلغان بعملتين).
-- ============================================================================

-- 1 · دفتر المنصة — للإضافة فقط كدفتر البائع ---------------------------------

CREATE TABLE "platform_ledger_entries" (
  "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
  "subOrderId"       UUID        NOT NULL,
  "currency"         CHAR(3)     NOT NULL,
  -- commission · tax_held · discount_subsidy · rounding
  "entryType"        TEXT        NOT NULL,
  -- credit = للمنصة، debit = عليها
  "direction"        TEXT        NOT NULL,
  "amountMinorUnits" BIGINT      NOT NULL,
  "reversesEntryId"  UUID,
  "refundId"         UUID,
  "memo"             TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "platform_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_ledger_suborder_fk" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_ledger_currency_fk" FOREIGN KEY ("currency") REFERENCES "currencies"("code"),
  CONSTRAINT "platform_ledger_amount_positive" CHECK ("amountMinorUnits" > 0),
  CONSTRAINT "platform_ledger_direction_valid" CHECK ("direction" IN ('credit', 'debit')),
  CONSTRAINT "platform_ledger_type_valid" CHECK ("entryType" IN ('commission', 'tax_held', 'discount_subsidy', 'rounding'))
);
CREATE INDEX "platform_ledger_entries_subOrderId_idx" ON "platform_ledger_entries"("subOrderId");
CREATE INDEX "platform_ledger_entries_currency_createdAt_idx" ON "platform_ledger_entries"("currency", "createdAt");

CREATE TRIGGER "platform_ledger_entries_no_update_stmt"
  BEFORE UPDATE ON "platform_ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only();
CREATE TRIGGER "platform_ledger_entries_no_delete_stmt"
  BEFORE DELETE ON "platform_ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only();
CREATE TRIGGER "platform_ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "platform_ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only();

GRANT SELECT, INSERT ON "platform_ledger_entries" TO basta_ledger;
REVOKE UPDATE, DELETE, TRUNCATE ON "platform_ledger_entries" FROM basta_ledger;

-- 2 · الاسترداد يحمل قيمته بعملة البائع ---------------------------------------
-- amountMinorUnits بعملة الدفع (ما وصل البوابة)، وهذا ما يقابله في دفتر البائع

ALTER TABLE "refunds" ADD COLUMN "vendorAmountMinorUnits" BIGINT;
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_vendor_amount_nonnegative" CHECK ("vendorAmountMinorUnits" IS NULL OR "vendorAmountMinorUnits" >= 0);

-- 3 · عدم التكرار في قاعدة البيانات لا في التطبيق وحده --------------------------
-- بيع واحد لكل فرعي، وتحرير واحد — مهمّتان متزامنتان لا تقيّدان مرتين

CREATE UNIQUE INDEX "ledger_one_sale_per_sub_order"
  ON "ledger_entries"("refId") WHERE "entryType" = 'sale_credit' AND "reversesEntryId" IS NULL;
CREATE UNIQUE INDEX "ledger_one_release_per_sub_order"
  ON "ledger_entries"("refId") WHERE "entryType" = 'hold_release_out' AND "reversesEntryId" IS NULL;
-- لا فهرس فريد على reversesEntryId: إرجاعان جزئيان يعكسان جزأين من عمولة واحدة

-- 4 · متى بدأ الدفتر — ما قبله طلبات تجريبية بلا قيود --------------------------

INSERT INTO "settings" ("key", "valueJson", "updatedAt")
VALUES ('ledger_started_at', to_jsonb(now()), now())
ON CONFLICT ("key") DO NOTHING;

-- 5 · بوابة 10 البند 1: حفظ المال لكل فرعي، بعملة بائعه، بلا سماحية -----------

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
JOIN "ledger_entries" sale
  ON sale."refId" = s."id" AND sale."entryType" = 'sale_credit' AND sale."reversesEntryId" IS NULL
LEFT JOIN vendor   v ON v.sub_order_id = s."id"
LEFT JOIN platform p ON p.sub_order_id = s."id"
LEFT JOIN refunded r ON r.sub_order_id = s."id"
WHERE s."totalMinorUnits" <> COALESCE(v.net, 0) + COALESCE(p.net, 0) + COALESCE(r.total, 0);

-- فرعي مدفوع بعد بدء الدفتر بلا قيد بيع: مال دخل ولم يصل دفتر أحد
CREATE OR REPLACE VIEW "audit_sub_order_without_ledger" AS
SELECT s."id" AS sub_order_id, s."subOrderNumber", s."placedAt"
FROM "sub_orders" s
WHERE s."placedAt" >= (SELECT ("valueJson" #>> '{}')::timestamptz FROM "settings" WHERE "key" = 'ledger_started_at')
  AND NOT EXISTS (
    SELECT 1 FROM "ledger_entries" l
    WHERE l."refId" = s."id" AND l."entryType" = 'sale_credit' AND l."reversesEntryId" IS NULL
  );

-- محفظة: المسحوب = صافي قيود السحب (INV-03 للجيب الثالث)
CREATE OR REPLACE VIEW "audit_withdrawn_drift" AS
SELECT w."id" AS wallet_id, w."balanceWithdrawnMinorUnits" AS stored,
       COALESCE(SUM(CASE WHEN l."direction" = 'debit' THEN l."amountMinorUnits" ELSE -l."amountMinorUnits" END), 0) AS computed
FROM "wallets" w
LEFT JOIN "ledger_entries" l ON l."walletId" = w."id" AND l."entryType" = 'payout_debit'
GROUP BY w."id", w."balanceWithdrawnMinorUnits"
HAVING w."balanceWithdrawnMinorUnits" <> COALESCE(SUM(CASE WHEN l."direction" = 'debit' THEN l."amountMinorUnits" ELSE -l."amountMinorUnits" END), 0);
