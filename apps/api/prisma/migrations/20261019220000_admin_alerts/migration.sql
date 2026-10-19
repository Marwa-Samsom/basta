-- تنبيهات الإدارة من المهمة الدورية تُرسل مرة لكل حالة (19 أكتوبر 2026): مرتجع لم يُستلم
-- بعد 3 أيام، طلب قارب مهلة القبول، انحراف في منظرات التدقيق (مرة في اليوم لكل منظر).
-- المهمة ترى الحالة في كل دورة، والمفتاح الفريد يمنع تكرار الإشعار ولو تزامنت دورتان.
CREATE TABLE "admin_alerts" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("key")
);
