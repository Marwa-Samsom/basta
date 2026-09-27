-- ============================================================================
-- التحقق بخطوتين لكل الحسابات — رموز الاستعادة
--
-- كان التحقق الثنائي للإدارة وحدها. تعميمه على العملاء والبائعين بلا طريق
-- عودة يُقفل حساب من أضاع جهازه للأبد. عشرة رموز تُعطى مرة واحدة عند
-- التفعيل، كلٌّ صالح لدخول واحد بدل رمز التطبيق.
--
-- الرمز يُخزَّن مجزّأً بـ argon2 كما كلمة المرور: يعيش سنوات، فتجزئة سريعة
-- بلا ملح تُكسَر إن تسرّبت القاعدة. `usedAt` يُكتب بشرط `IS NULL` فدخولان
-- متزامنان بالرمز نفسه لا ينجحان معاً.
-- ============================================================================

CREATE TABLE "totp_recovery_codes" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "userId"    UUID         NOT NULL,
  "codeHash"  TEXT         NOT NULL,
  "usedAt"    TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "totp_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "totp_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "totp_recovery_codes_userId_idx" ON "totp_recovery_codes"("userId");
