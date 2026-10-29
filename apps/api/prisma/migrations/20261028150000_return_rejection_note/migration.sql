-- سبب رفض البائع للإرجاع على طلب الإرجاع نفسه — BUY-047، 28 أكتوبر 2026.
--
-- كان السبب في سجلّ الحالات وحده، فلا يراه المشتري مع أن حقله عند البائع يقول «يُعرض للمشتري».
-- ما رُفض قبل اليوم يأخذ سببه من سطر السجلّ الذي كُتب معه (الفرق ثوانٍ: الوقتان من المعاملة نفسها).
ALTER TABLE "return_requests" ADD COLUMN "resolutionNote" TEXT;

UPDATE "return_requests" r SET "resolutionNote" = h."reason"
FROM "sub_order_status_history" h
WHERE r."status" = 'rejected'
  AND h."subOrderId" = r."subOrderId"
  AND h."fromStatus" = 'return_requested'
  AND h."toStatus" = 'delivered'
  AND h."reason" IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (h."createdAt" - r."resolvedAt"))) < 60;
