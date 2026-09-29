-- ============================================================================
-- فهارس أعمدة الفترة في تقارير الإدارة ولوحتها
--
-- التقرير المالي يجمع سبعة جداول بشرط تاريخ (paidAt أو createdAt أو placedAt)،
-- ولا فهرس يبدأ بأيٍّ منها: الفهارس القائمة تبدأ بالبائع أو العملة أو الحالة،
-- فيمسح كل تقرير الجداول كاملةً — والدفتران أسرع الجداول نموّاً.
-- والفترة صار لها سقف (366 يوماً) في rangeOf.
--
-- الجزئيان لطابورَي اللوحة: منتجات تنتظر المراجعة (بترتيب الانتظار)، وطلبات
-- تنتظر قبول البائع (بعمرها — والمهمة الدورية التي تلغي المتأخّر تقرؤه أيضاً).
-- ============================================================================

CREATE INDEX "orders_paidAt_idx" ON "orders" ("paidAt");
CREATE INDEX "refunds_createdAt_idx" ON "refunds" ("createdAt");
CREATE INDEX "ledger_entries_createdAt_idx" ON "ledger_entries" ("createdAt");
CREATE INDEX "platform_ledger_entries_createdAt_idx" ON "platform_ledger_entries" ("createdAt");
CREATE INDEX "payout_requests_paidAt_idx" ON "payout_requests" ("paidAt");
CREATE INDEX "sub_orders_placedAt_idx" ON "sub_orders" ("placedAt");
CREATE INDEX "carts_createdAt_idx" ON "carts" ("createdAt");

CREATE INDEX "products_review_queue_idx" ON "products" ("updatedAt") WHERE "status" = 'pending_review' AND "deletedAt" IS NULL;
CREATE INDEX "sub_orders_awaiting_vendor_idx" ON "sub_orders" ("placedAt") WHERE "status" = 'awaiting_vendor';
