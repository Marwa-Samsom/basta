-- SYS-034: الإشعار يُحجز «يُرسل» بمهلة دقيقتين في nextAttemptAt، فإن سقط مرسِله قبل الختام
-- التقطه غيره بعدها. ما علق «يُرسل» قبل هذا الإصلاح بلا مهلة: يُلتقط في أول دورة بعد الإقلاع.
UPDATE "notifications" SET "nextAttemptAt" = CURRENT_TIMESTAMP WHERE "status" = 'sending' AND "nextAttemptAt" IS NULL;
