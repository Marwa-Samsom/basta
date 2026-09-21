-- ============================================================================
-- المرحلة 08 — إتمام الشراء: التقسيم يقع لحظة نجاح الدفع (ADR-003)
--
-- 1. الطلب الأب يُنشأ عند بدء الدفع بلقطة تسعير كاملة، والطلبات الفرعية لا
--    تُنشأ إلا بعد نجاحه. لقطة التسعير هي ما يُقسَّم — لا السلة، فالسلة قد
--    تتغيّر بعد أن ضغط المشتري «ادفع».
--
-- 2. بوابة المرحلة: **مجموع الفرعية = الأب بالقرش الواحد.** المبالغ الفرعية
--    بعملة البائع، والأب بعملة المشتري، فالمقارنة بينهما تمرّ بسعر صرف
--    وتقريب. لذلك يحمل كل فرعي حصّته **بعملة الدفع** مباشرةً، والأب مجموع
--    هذه الحصص بالبناء. المنظر الصارم أدناه يفحص المساواة بلا سماحية.
-- ============================================================================

ALTER TABLE "orders"
  ADD COLUMN "pricingSnapshot" JSONB,
  ADD COLUMN "reservationIds"  UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN "paidAt"          TIMESTAMPTZ;

ALTER TABLE "sub_orders"
  ADD COLUMN "chargeTotalMinorUnits" BIGINT;

-- المبالغ لا تكون سالبة، والمجموع يطابق مكوّناته — في الأب
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_nonnegative_check"
  CHECK ("itemsSubtotalMinorUnits" >= 0 AND "shippingTotalMinorUnits" >= 0
     AND "discountTotalMinorUnits" >= 0 AND "taxTotalMinorUnits" >= 0
     AND "grandTotalMinorUnits" >= 0);

-- الطلب الذي بدأ دفعه يحمل لقطته: بلاها لا شيء يُقسَّم عند النجاح
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_snapshot_present_check"
  CHECK ("pricingSnapshot" IS NOT NULL OR "status" <> 'pending_payment');

-- INV-01 بصرامة البوابة: حصص الفرعية بعملة الدفع = الأب، بلا سماحية
CREATE OR REPLACE VIEW "audit_order_split_drift" AS
SELECT
  o."id" AS order_id,
  o."orderNumber",
  o."grandTotalMinorUnits"           AS parent_total,
  SUM(s."chargeTotalMinorUnits")     AS children_charge_total,
  COUNT(s."id")                      AS sub_order_count
FROM "orders" o
JOIN "sub_orders" s ON s."orderId" = o."id"
WHERE o."status" NOT IN ('pending_payment', 'payment_failed')
GROUP BY o."id", o."orderNumber", o."grandTotalMinorUnits"
HAVING SUM(s."chargeTotalMinorUnits") IS DISTINCT FROM o."grandTotalMinorUnits";

-- مدفوع بلا طلبات فرعية: دفع المشتري ولم يصل شيء إلى أي بائع
CREATE OR REPLACE VIEW "audit_paid_without_split" AS
SELECT o."id" AS order_id, o."orderNumber", o."paidAt"
FROM "orders" o
LEFT JOIN "sub_orders" s ON s."orderId" = o."id"
WHERE o."paidAt" IS NOT NULL
GROUP BY o."id", o."orderNumber", o."paidAt"
HAVING COUNT(s."id") = 0;

CREATE INDEX "orders_pending_payment_idx"
  ON "orders"("placedAt")
  WHERE "status" = 'pending_payment';
