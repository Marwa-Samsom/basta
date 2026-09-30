-- ============================================================================
-- مالك المنصة — مدير لا يمسّه مدير آخر
--
-- كل مدير بصلاحية users.manage كان يمنح نفسه كل الصلاحيات ويسحب الإدارة من
-- غيره، ومنهم المدير الأول. الآن لا يُمنح ولا يُسحب إلا ما يحمله المانح نفسه،
-- ومالك المنصة وحده فوق هذه القاعدة ولا يغيّره غيره.
--
-- مالك واحد على الأكثر (فهرس فريد جزئي). يُعيَّن من سكربت المدير الأول
-- (admin:grant) لا من اللوحة. والمنصّات القائمة: صاحب أول admin.bootstrap في
-- سجل التدقيق، وإلا أقدم مدير يحمل users.manage.
-- ============================================================================

ALTER TABLE "users" ADD COLUMN "isPlatformOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "users_single_platform_owner" ON "users" ("isPlatformOwner") WHERE "isPlatformOwner";

UPDATE "users" SET "isPlatformOwner" = true
WHERE "id" = COALESCE(
  -- entityId نصّ في السجل: يُقارن نصّاً، ويُحوَّل الناتج وحده
  (SELECT a."entityId" FROM "audit_logs" a
     JOIN "user_roles" r ON r."userId"::text = a."entityId" AND r."role" = 'admin'
    WHERE a."action" = 'admin.bootstrap'
    ORDER BY a."createdAt" ASC LIMIT 1)::uuid,
  (SELECT u."id" FROM "users" u
     JOIN "user_roles" r ON r."userId" = u."id" AND r."role" = 'admin'
     JOIN "admin_permissions" p ON p."userId" = u."id" AND p."permission" = 'users.manage'
    ORDER BY u."createdAt" ASC LIMIT 1)
);
