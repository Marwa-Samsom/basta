-- ============================================================================
-- سدّ ثغرتين في حرّاس ADR-005 كشفهما اختبار db-guards.spec.ts
--
-- الثغرة 1 — مشغّل الصف لا يُطلَق على جدول فارغ.
--   `DELETE FROM "ledger_entries"` على جدول بلا صفوف كان يمرّ بنجاح.
--   غير ضارّ بذاته، لكنه يعني أن الحارس ليس قاعدة مطلقة بل أثراً جانبياً
--   لوجود بيانات — وقاعدة بهذا الشرط تسقط في أول حالة حافة.
--
-- الثغرة 2 — TRUNCATE يتجاوز مشغّلات الصفوف كلياً، ولو كان الجدول ممتلئاً.
--   هذه ثغرة فعلية: أمر واحد يمحو الدفتر كاملاً بلا اعتراض من أي حارس.
--
-- العلاج: مشغّلات على مستوى الجملة (FOR EACH STATEMENT) تُطلَق دائماً،
-- مهما كان عدد الصفوف، زائد مشغّل TRUNCATE منفصل — وهو النوع الوحيد
-- الذي يعترض هذا الأمر.
-- ============================================================================

-- الرسالة تسمّي العملية والجدول وسبيل التصحيح — لا «حدث خطأ»
CREATE OR REPLACE FUNCTION basta_ledger_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'جدول % للإضافة فقط (ADR-005). العملية % مرفوضة مهما كان عدد الصفوف. التصحيح يكون بقيد معاكس يحمل reversesEntryId، لا بتعديل ولا حذف.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'audit_logs', 'inventory_movements', 'exchange_rates']
  LOOP
    -- مشغّلات الصفوف القديمة: تُستبدل بمشغّلات الجملة
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_update', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_delete', t);

    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only()',
      t || '_no_update_stmt', t);

    -- أسعار الصرف تقبل الإضافة والحذف ممنوع، لكن لا مانع من حذف صفّ خاطئ
    -- قبل استعماله؟ لا — السعر قد يكون مرجعاً في لقطة طلب. الحذف ممنوع أيضاً.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only()',
      t || '_no_delete_stmt', t);

    -- الثغرة الحقيقية: TRUNCATE لا يمرّ بمشغّلات الصفوف إطلاقاً
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only()',
      t || '_no_truncate', t);
  END LOOP;
END
$$;

-- الدور المالي لا يملك TRUNCATE أصلاً — حزام ثانٍ فوق المشغّل
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basta_ledger') THEN
    EXECUTE 'REVOKE TRUNCATE ON "ledger_entries", "audit_logs", "inventory_movements", "exchange_rates" FROM basta_ledger';
  END IF;
END
$$;
