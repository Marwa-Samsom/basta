-- الدفع بتحويل يدوي (بنكي أو كليك) — UX-OPS-AUDIT البند 8.
-- المشتري يحوّل، والإدارة تؤكّد الوصول بمرجع التحويل، وعندها فقط يُقسَّم الطلب
-- ويُقيَّد للبائع. والردّ يبقى «بانتظار التحويل» حتى تسجّل الإدارة مرجع ما أرسلته.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'awaiting_transfer' AFTER 'requires_action';

ALTER TABLE "payments"
  ADD COLUMN "expiresAt" TIMESTAMPTZ,
  ADD COLUMN "transferReference" TEXT,
  ADD COLUMN "transferNote" TEXT,
  ADD COLUMN "confirmedBy" UUID,
  ADD COLUMN "confirmedAt" TIMESTAMPTZ;

ALTER TABLE "refunds" ADD COLUMN "transferReference" TEXT;

-- طابور الإدارة: الردود التي تنتظر تحويلاً يدوياً
CREATE INDEX "refunds_awaiting_transfer_createdAt_idx" ON "refunds" ("createdAt") WHERE "status" = 'awaiting_transfer';
