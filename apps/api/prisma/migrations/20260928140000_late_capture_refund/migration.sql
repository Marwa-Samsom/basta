-- ============================================================================
-- دفع يصل بعد إغلاق الطلب
--
-- نجاحٌ يصل من البوابة لطلب خُتم payment_failed أو canceled (انتهت مهلة
-- التحقق، أو حسمته المصالحة) كان يُرمى بصمت: markPaid يشترط pending_payment
-- فيعود بلا أثر — والمال خُصم من المشتري بلا طلب ولا ردّ.
--
-- الآن يُردّ: lateCaptureAt حجزٌ شرطي يأخذه مسار واحد (إشعار ومصالحة معاً لا
-- يردّان مرتين)، والردّ بمفتاح عدم تكرار عند البوابة، و lateRefundId يثبت أنه
-- تمّ. حجزٌ بلا ردّ (سقطت البوابة أو الخادم) تعيده المصالحة الدورية.
-- ============================================================================

ALTER TABLE "payments" ADD COLUMN "lateCaptureAt" TIMESTAMPTZ;
ALTER TABLE "payments" ADD COLUMN "lateRefundId" TEXT;

-- المصالحة تبحث عن حجوز لم تُردّ — فهرس جزئي صغير بقدرها
CREATE INDEX "payments_late_capture_pending_idx" ON "payments" ("lateCaptureAt")
  WHERE "lateCaptureAt" IS NOT NULL AND "lateRefundId" IS NULL;
