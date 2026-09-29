-- ============================================================================
-- البريد بصيغة واحدة — لا حسابان لصندوق واحد
--
-- البريد كان يُخزَّن كما كُتب، والفهرس الفريد يفرّق بين الحروف: Victim@x.com
-- و victim@x.com حسابان. من سجّل الثاني تصله رموز الاستعادة باسم صندوق غيره.
--
-- القيد يرفض أي بريد غير مصغَّر ومشذَّب، فيصير الفهرس الفريد القائم على email
-- فريداً بلا اعتبار للحروف. الخادم يوحّد قبل الكتابة (common/email.ts).
--
-- حسابان يختلفان بالحروف وحدها لا يُدمجان آلياً: أيّهما صاحب الصندوق قرار
-- بشري. المهاجرة تتوقّف وتسمّيهما.
-- ============================================================================

DO $$
DECLARE clash TEXT;
BEGIN
  SELECT string_agg(e, '، ') INTO clash FROM (
    SELECT lower(btrim(email)) AS e FROM "users" WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'حسابات تختلف بحروف البريد وحدها — تُحسم يدوياً قبل المهاجرة: %', clash;
  END IF;
END $$;

UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email")));
