-- ============================================================================
-- بسطة — الحرّاس والقيود التي لا يعبّر عنها Prisma
--
-- هذه المهاجرة ليست تحسيناً: هي المكان الذي تُفرض فيه ثوابت المرحلة 01
-- على مستوى قاعدة البيانات، حيث لا يستطيع خطأ في التطبيق تجاوزها.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 · المخزون لا يصبح سالباً — INV-05 · SRS V-04
-- ----------------------------------------------------------------------------

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_on_hand_non_negative"  CHECK ("onHand"   >= 0),
  ADD CONSTRAINT "inventory_reserved_non_negative" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "inventory_reserved_lte_on_hand"  CHECK ("reserved" <= "onHand");

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "reservation_qty_positive" CHECK ("qty" > 0);


-- ----------------------------------------------------------------------------
-- 2 · دفتر الأستاذ للإضافة فقط — ADR-005 · INV-08
--
-- الحماية هنا لا في التطبيق. مطوّر يكتب UPDATE على الدفتر — عمداً أو سهواً —
-- يصطدم بهذا المشغّل، لا بمراجعة كود قد تفوته.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION basta_ledger_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'دفتر الأستاذ للإضافة فقط (ADR-005). العملية % مرفوضة على %. صحّح بقيد معاكس يحمل reversesEntryId.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_no_update"
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();

CREATE TRIGGER "ledger_entries_no_delete"
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();

-- سجل التدقيق وحركات المخزون وأحداث الدفع تخضع للقاعدة نفسها
CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();
CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();

CREATE TRIGGER "inventory_movements_no_update"
  BEFORE UPDATE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();
CREATE TRIGGER "inventory_movements_no_delete"
  BEFORE DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();

CREATE TRIGGER "exchange_rates_no_update"
  BEFORE UPDATE ON "exchange_rates"
  FOR EACH ROW EXECUTE FUNCTION basta_ledger_is_append_only();


-- ----------------------------------------------------------------------------
-- 3 · قيود الدفتر الداخلية
-- ----------------------------------------------------------------------------

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_amount_positive"  CHECK ("amountMinorUnits" > 0),
  ADD CONSTRAINT "ledger_direction_valid"  CHECK ("direction" IN ('credit', 'debit')),
  ADD CONSTRAINT "ledger_bucket_valid"     CHECK ("bucket" IN ('pending', 'available'));

-- المبلغ دائماً موجب، والاتجاه هو ما يحدد الإشارة. مبلغ سالب مع اتجاه
-- يفتح باب قيدين مختلفين بالمعنى نفسه، وهو ما يفسد أي تدقيق لاحق.

ALTER TABLE "payout_requests"
  ADD CONSTRAINT "payout_amount_positive" CHECK ("amountMinorUnits" > 0);

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_bps_range" CHECK ("rateBps" >= 0 AND "rateBps" <= 10000);

ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_bps_range" CHECK ("rateBps" >= 0 AND "rateBps" <= 10000);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_commission_bps_range" CHECK ("commissionBpsSnapshot" >= 0 AND "commissionBpsSnapshot" <= 10000),
  ADD CONSTRAINT "order_item_qty_positive"         CHECK ("qty" > 0),
  ADD CONSTRAINT "order_item_refunded_lte_qty"     CHECK ("refundedQty" >= 0 AND "refundedQty" <= "qty");

ALTER TABLE "reviews"
  ADD CONSTRAINT "review_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5);

ALTER TABLE "currencies"
  ADD CONSTRAINT "currency_minor_digits_range" CHECK ("minorUnitDigits" >= 0 AND "minorUnitDigits" <= 4);


-- ----------------------------------------------------------------------------
-- 4 · عملة واحدة أساسية للمحاسبة — ADR-013
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX "currencies_single_base"
  ON "currencies" (("isBase")) WHERE "isBase" = true;


-- ----------------------------------------------------------------------------
-- 5 · الفهارس الجزئية — تجعل المهام المجدولة استعلاماً واحداً رخيصاً
-- ----------------------------------------------------------------------------

-- مهمة تحرير الحجوزات، كل دقيقة
CREATE INDEX "stock_reservations_active_expiry"
  ON "stock_reservations" ("expiresAt")
  WHERE "status" = 'active';

-- مهمة تحرير الأرصدة المستحقة، يومياً — ADR-007
CREATE INDEX "sub_orders_pending_hold_release"
  ON "sub_orders" ("holdReleaseAt")
  WHERE "status" = 'delivered' AND "completedAt" IS NULL;

-- مهمة إلغاء الطلبات غير المقبولة خلال 48 ساعة — Q-07
CREATE INDEX "sub_orders_awaiting_vendor"
  ON "sub_orders" ("placedAt")
  WHERE "status" = 'awaiting_vendor';

-- مهمة تسوية المدفوعات المعلّقة، كل 10 دقائق
CREATE INDEX "payments_awaiting_reconcile"
  ON "payments" ("createdAt")
  WHERE "status" IN ('pending', 'requires_action', 'authorized');

-- تصفّح الكتالوج — المنتجات المنشورة فقط
CREATE INDEX "products_browse_active"
  ON "products" ("categoryId", "publishedAt" DESC)
  WHERE "status" = 'active' AND "deletedAt" IS NULL;


-- ----------------------------------------------------------------------------
-- 6 · مستخدم الدفتر — ADR-005
--
-- المستخدم الذي يكتب القيود لا يملك صلاحية تعديلها ولا حذفها،
-- فحتى ثغرة حقن SQL في مسار مالي لا تستطيع محو قيد.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basta_ledger') THEN
    CREATE ROLE basta_ledger LOGIN PASSWORD 'ledger_dev_pw';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE basta TO basta_ledger;
GRANT USAGE ON SCHEMA public TO basta_ledger;
GRANT SELECT, INSERT ON "ledger_entries" TO basta_ledger;
GRANT SELECT, UPDATE ON "wallets"        TO basta_ledger;
GRANT SELECT ON "sub_orders", "vendors", "currencies", "settings" TO basta_ledger;
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entries" FROM basta_ledger;


-- ----------------------------------------------------------------------------
-- 7 · دوال التدقيق الليلي — INV-03 · INV-04 · INV-11
--
-- تُستدعى من المهمة الليلية. لا تُصحّح شيئاً — تكشف الانحراف فقط،
-- لأن التصحيح الآلي لخلل مالي يخفي سببه.
-- ----------------------------------------------------------------------------

-- INV-03: رصيد كل محفظة = مجموع قيود دفترها، لكل جيب وعملة
CREATE OR REPLACE VIEW "audit_wallet_drift" AS
SELECT
  w."id"        AS wallet_id,
  w."vendorId"  AS vendor_id,
  w."currency",
  w."balancePendingMinorUnits"   AS stored_pending,
  COALESCE(SUM(CASE WHEN l."bucket" = 'pending'
    THEN CASE WHEN l."direction" = 'credit' THEN l."amountMinorUnits" ELSE -l."amountMinorUnits" END
    ELSE 0 END), 0) AS computed_pending,
  w."balanceAvailableMinorUnits" AS stored_available,
  COALESCE(SUM(CASE WHEN l."bucket" = 'available'
    THEN CASE WHEN l."direction" = 'credit' THEN l."amountMinorUnits" ELSE -l."amountMinorUnits" END
    ELSE 0 END), 0) AS computed_available
FROM "wallets" w
LEFT JOIN "ledger_entries" l ON l."walletId" = w."id"
GROUP BY w."id", w."vendorId", w."currency",
         w."balancePendingMinorUnits", w."balanceAvailableMinorUnits"
HAVING
  w."balancePendingMinorUnits" <> COALESCE(SUM(CASE WHEN l."bucket" = 'pending'
    THEN CASE WHEN l."direction" = 'credit' THEN l."amountMinorUnits" ELSE -l."amountMinorUnits" END
    ELSE 0 END), 0)
  OR
  w."balanceAvailableMinorUnits" <> COALESCE(SUM(CASE WHEN l."bucket" = 'available'
    THEN CASE WHEN l."direction" = 'credit' THEN l."amountMinorUnits" ELSE -l."amountMinorUnits" END
    ELSE 0 END), 0);

-- INV-04: مجموع حركات المخزون = الرصيد الفعلي
CREATE OR REPLACE VIEW "audit_inventory_drift" AS
SELECT
  i."variantId",
  i."onHand" AS stored_on_hand,
  COALESCE(SUM(m."delta"), 0) AS computed_on_hand
FROM "inventory" i
LEFT JOIN "inventory_movements" m ON m."variantId" = i."variantId"
GROUP BY i."variantId", i."onHand"
HAVING i."onHand" <> COALESCE(SUM(m."delta"), 0);

-- INV-11: reserved = مجموع الحجوزات النشطة. الانحراف يعني حجزاً مسرَّباً
--         أي مخزوناً مجمَّداً بلا سبب، وهو عطل صامت لا يشتكي منه أحد
CREATE OR REPLACE VIEW "audit_reservation_drift" AS
SELECT
  i."variantId",
  i."reserved" AS stored_reserved,
  COALESCE(SUM(r."qty"), 0) AS computed_reserved
FROM "inventory" i
LEFT JOIN "stock_reservations" r
  ON r."variantId" = i."variantId" AND r."status" = 'active'
GROUP BY i."variantId", i."reserved"
HAVING i."reserved" <> COALESCE(SUM(r."qty"), 0);

-- INV-01: مجموع الطلبات الفرعية = الطلب الأب، بعد التحويل بسعر الصرف الملقوط
CREATE OR REPLACE VIEW "audit_order_total_drift" AS
SELECT
  o."id" AS order_id,
  o."orderNumber",
  o."grandTotalMinorUnits" AS parent_total,
  SUM(ROUND(s."totalMinorUnits" / s."fxRateSnapshot"))::bigint AS children_total_converted,
  COUNT(s."id") AS sub_order_count
FROM "orders" o
JOIN "sub_orders" s ON s."orderId" = o."id"
WHERE o."status" NOT IN ('pending_payment', 'payment_failed')
GROUP BY o."id", o."orderNumber", o."grandTotalMinorUnits"
-- سماحية فلس واحد لكل فرعي — أثر التقريب في التحويل، لا خطأ
HAVING ABS(o."grandTotalMinorUnits" - SUM(ROUND(s."totalMinorUnits" / s."fxRateSnapshot"))::bigint)
       > COUNT(s."id");
