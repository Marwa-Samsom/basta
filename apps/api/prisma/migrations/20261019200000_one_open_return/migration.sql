-- طلب إرجاع قائم واحد لكل طلب فرعي — J-05، 19 أكتوبر 2026.
--
-- كان صفّ الطلب يُكتب قبل الانتقال وخارج معاملته: طلبان متزامنان يمرّ أحدهما ويُرفض
-- الآخر، ويبقى صفّ المرفوض «requested». ظهر القميص مرتين في /admin/returns، والثاني
-- زرّه يرفض بـ«حالة نهائية»، ومهمة تحرير الرصيد تشترط ألا يبقى إرجاع requested فعلق
-- مال البائع. الكود يكتب الصفّ الآن في معاملة الانتقال؛ وهذا القيد يضمنه في القاعدة.

-- صفّ «requested» بعده صفّ أحدث للفرعي نفسه لم يعد قائماً: طلب جديد لا يُكتب إلا بعد
-- حسم ما قبله، فالأقدم يتيم سباق — لم يُسجَّل انتقاله، فلا مال ولا قطع وراءه
DELETE FROM "return_requests" r
 WHERE r."status" = 'requested'
   AND EXISTS (
     SELECT 1 FROM "return_requests" n
      WHERE n."subOrderId" = r."subOrderId"
        AND (n."requestedAt", n."id") > (r."requestedAt", r."id")
   );

CREATE UNIQUE INDEX "return_requests_one_open_idx" ON "return_requests" ("subOrderId") WHERE "status" = 'requested';
