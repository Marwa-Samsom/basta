-- ============================================================================
-- رموز الهوية لا تبقى في سجل الإشعارات
--
-- كان الإشعار المرسَل يحفظ الرمز في `payloadJson` وفي العنوان والنص كما
-- صُيّرا، وسجل الإدارة يعرض العنوان. فمن يملك `content.manage` يكتب `{{code}}`
-- في عنوان قالب الاستعادة، ويطلب استعادة لحساب غيره، ويقرأ الرمز من السجل.
-- الإرسال صار يمحو الرمز عند الختام؛ وهنا يُمحى مما أُرسل قبل ذلك.
-- ما زال في الطابور يبقى رمزه حتى يُرسل — ثم يُمحى بالمسار نفسه.
-- ============================================================================

UPDATE "notifications"
   SET "subject"     = replace("subject", "payloadJson"->>'code', '••••••'),
       "body"        = replace("body",    "payloadJson"->>'code', '••••••'),
       "payloadJson" = jsonb_set("payloadJson"::jsonb, '{code}', '"••••••"')
 WHERE "templateCode" IN ('password_reset_code', 'email_verify_code')
   AND "status" NOT IN ('queued', 'sending')
   AND "payloadJson" ? 'code'
   AND "payloadJson"->>'code' <> '••••••';
