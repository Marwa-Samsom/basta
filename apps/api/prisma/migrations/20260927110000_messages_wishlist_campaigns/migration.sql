-- ============================================================================
-- الشاشات الست الأخيرة — الرسائل، والمفضّلة، والحملات، وإعدادات البائع
--
-- الرسائل (ST-09 · ST-28 · VD-15): محادثة واحدة لكل (مشترٍ، متجر، سياق)،
-- ورسائلها للإضافة فقط — قد تصير دليلاً في نزاع، فلا تعديل ولا حذف.
--
-- المفضّلة (ST-23): السعر لحظة الحفظ ليُقال «انخفض منذ حفظه».
--
-- الحملات (AD-17): مدة ومنتجات مرتّبة يدوياً وموضع وكوبون اختياري.
--
-- إعدادات البائع (VD-20): تفضيلات البريد لكل فئة، وحسابات بنكية متعدّدة —
-- الجديد منها لا يصير افتراضياً قبل توثيق مدير، لأن تبديل وجهة التحويل
-- بجلسة مسروقة هو أقصر طريق لسرقة رصيد البائع.
-- ============================================================================

-- ------------------------------------------------------------ إعدادات البائع

ALTER TABLE "users" ADD COLUMN "notificationPrefs" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "vendor_bank_accounts"
  ADD COLUMN "verifiedBy" UUID,
  ADD COLUMN "archivedAt" TIMESTAMPTZ;

-- الحساب الذي دخل مع طلب التسجيل وثّقته مراجعة الاعتماد نفسها (وثيقة
-- bank_proof) — ولم يكن أحد يكتب verifiedAt حتى الآن
UPDATE "vendor_bank_accounts" b
   SET "verifiedAt" = v."approvedAt", "verifiedBy" = v."approvedBy"
  FROM "vendors" v
 WHERE b."vendorId" = v."id" AND v."approvedAt" IS NOT NULL AND b."verifiedAt" IS NULL;

-- افتراضي واحد حيّ لكل بائع
CREATE UNIQUE INDEX "vendor_bank_accounts_one_default"
  ON "vendor_bank_accounts"("vendorId") WHERE "isDefault" AND "archivedAt" IS NULL;

-- ------------------------------------------------------------------ الرسائل

CREATE TABLE "conversations" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "customerId"     UUID        NOT NULL,
  "vendorId"       UUID        NOT NULL,
  "contextKey"     TEXT        NOT NULL,
  "productId"      UUID,
  "subOrderId"     UUID,
  "lastMessageAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lastPreview"    TEXT        NOT NULL,
  "lastSenderSide" TEXT        NOT NULL,
  "customerReadAt" TIMESTAMPTZ,
  "vendorReadAt"   TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversations_side_check" CHECK ("lastSenderSide" IN ('customer', 'vendor')),
  -- المفتاح يطابق العمود الذي يسمّيه — لا سياق منتج بلا منتج
  CONSTRAINT "conversations_context_check" CHECK (
       ("contextKey" = 'general' AND "productId" IS NULL AND "subOrderId" IS NULL)
    OR ("contextKey" = 'product:' || "productId"::text AND "subOrderId" IS NULL)
    OR ("contextKey" = 'order:' || "subOrderId"::text AND "productId" IS NULL)
  ),
  CONSTRAINT "conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "conversations_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "conversations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "conversations_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "conversations_customerId_vendorId_contextKey_key" ON "conversations"("customerId", "vendorId", "contextKey");
CREATE INDEX "conversations_customerId_lastMessageAt_idx" ON "conversations"("customerId", "lastMessageAt" DESC);
CREATE INDEX "conversations_vendorId_lastMessageAt_idx" ON "conversations"("vendorId", "lastMessageAt" DESC);

CREATE TABLE "conversation_messages" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID        NOT NULL,
  "senderUserId"   UUID        NOT NULL,
  "senderSide"     TEXT        NOT NULL,
  "body"           TEXT        NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_messages_side_check" CHECK ("senderSide" IN ('customer', 'vendor')),
  CONSTRAINT "conversation_messages_body_check" CHECK (char_length(btrim("body")) BETWEEN 1 AND 1000),
  CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "conversation_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "conversation_messages_conversationId_createdAt_idx" ON "conversation_messages"("conversationId", "createdAt");

-- للإضافة فقط، بحارس الجملة نفسه الذي يحرس الدفتر والتدقيق
CREATE TRIGGER "conversation_messages_no_update_stmt" BEFORE UPDATE ON "conversation_messages"
  FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only();
CREATE TRIGGER "conversation_messages_no_delete_stmt" BEFORE DELETE ON "conversation_messages"
  FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only();
CREATE TRIGGER "conversation_messages_no_truncate" BEFORE TRUNCATE ON "conversation_messages"
  FOR EACH STATEMENT EXECUTE FUNCTION basta_ledger_is_append_only();

-- ----------------------------------------------------------------- المفضّلة

CREATE TABLE "wishlist_items" (
  "userId"               UUID        NOT NULL,
  "productId"            UUID        NOT NULL,
  "savedPriceMinorUnits" BIGINT      NOT NULL,
  "currency"             CHAR(3)     NOT NULL,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("userId", "productId"),
  CONSTRAINT "wishlist_items_price_check" CHECK ("savedPriceMinorUnits" >= 0),
  CONSTRAINT "wishlist_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "wishlist_items_userId_createdAt_idx" ON "wishlist_items"("userId", "createdAt" DESC);

-- ------------------------------------------------------------------ الحملات

CREATE TABLE "campaigns" (
  "id"        UUID        NOT NULL DEFAULT gen_random_uuid(),
  "nameAr"    TEXT        NOT NULL,
  "placement" TEXT        NOT NULL,
  "couponId"  UUID,
  "startsAt"  TIMESTAMPTZ NOT NULL,
  "endsAt"    TIMESTAMPTZ NOT NULL,
  "isActive"  BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" UUID,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaigns_period_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "campaigns_placement_check" CHECK ("placement" IN ('home_top', 'home_middle')),
  CONSTRAINT "campaigns_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "campaigns_placement_startsAt_endsAt_idx" ON "campaigns"("placement", "startsAt", "endsAt");

CREATE TABLE "campaign_products" (
  "campaignId" UUID    NOT NULL,
  "productId"  UUID    NOT NULL,
  "sort"       INTEGER NOT NULL,
  CONSTRAINT "campaign_products_pkey" PRIMARY KEY ("campaignId", "productId"),
  CONSTRAINT "campaign_products_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "campaign_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "campaign_products_campaignId_sort_idx" ON "campaign_products"("campaignId", "sort");
