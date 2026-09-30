-- ============================================================================
-- مستخدم الدفتر basta_ledger يُحذف
--
-- أنشأته مهاجرة الحرّاس بكلمة مرور ثابتة في المستودع (ledger_dev_pw)، ومنحته
-- UPDATE على wallets — فمن قرأ المستودع يدخل به القاعدة ويضخّم الأرصدة. ولم
-- يتصل به التطبيق يوماً: الحماية التي وعد بها لم تكن موجودة، وبقي الخطر وحده.
--
-- الفصل الحقيقي مكانه مستخدم التشغيل الذي يتصل به التطبيق فعلاً (DATABASE_URL):
-- لا يملك الجداول، ولا UPDATE/DELETE له على جداول الإضافة فقط. كلمة مروره من
-- البيئة لا من مهاجرة، ويهيّئه `npm run db:app-role` بعد كل مهاجرة.
--
-- الحذف يحتاج صلاحية CREATEROLE؛ إن لم تكن لمنفّذ المهاجرة يُمنع الدخول على
-- الأقل وتُنزع صلاحياته، فلا تبقى كلمة المرور المعروفة مفتاحاً لشيء.
-- ============================================================================

DO $$
DECLARE
  d text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basta_ledger') THEN
    RETURN;
  END IF;

  -- نزع الصلاحيات يكفيه أن يكون المنفّذ مالك الجداول
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM basta_ledger';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM basta_ledger';
  EXECUTE 'REVOKE ALL ON SCHEMA public FROM basta_ledger';
  -- مهاجرة الحرّاس منحته CONNECT على قاعدة اسمها basta حرفياً، أياً كانت القاعدة
  -- الجارية — فيُنزع من كل قاعدة يقدر عليها المنفّذ، وإلا أبقى الحذفَ معلّقاً
  FOR d IN SELECT datname FROM pg_database WHERE NOT datistemplate LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON DATABASE %I FROM basta_ledger', d);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    -- قد تبقى له صلاحيات في قاعدة أخرى على الخادم نفسه (قاعدة ظلّ، اختبار)
    EXECUTE 'DROP OWNED BY basta_ledger';
    EXECUTE 'DROP ROLE basta_ledger';
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE 'ALTER ROLE basta_ledger NOLOGIN PASSWORD NULL';
      RAISE NOTICE 'basta_ledger لم يُحذف (%): مُنع الدخول وأُزيلت كلمة المرور.', SQLERRM;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'basta_ledger باقٍ بلا صلاحيات هنا، وتعذّر منع دخوله (%). احذفه بمستخدم يملك CREATEROLE.', SQLERRM;
    END;
  END;
END
$$;
