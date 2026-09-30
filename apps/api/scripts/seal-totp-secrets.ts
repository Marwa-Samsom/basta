/**
 * يشفّر أسرار التحقق الثنائي التي كُتبت نصّاً قبل secret-box — مرة واحدة عند النشر.
 *
 *   npm run totp:seal
 *
 * الخادم يشفّر السرّ القديم عند أول دخول ناجح لصاحبه، وهذا لمن لم يدخل بعد: ما
 * بقي نصّاً في القاعدة يقرؤه من قرأها. الكتابة شرطية على القيمة القديمة نفسها —
 * صاحب حساب يغيّر جهازه أثناء التشغيل لا يُكتب فوقه. التشغيل الثاني لا يجد شيئاً.
 */
import { PrismaClient } from '@prisma/client';
import { isLegacyPlain, sealTotpSecret } from '../src/modules/identity/infrastructure/secret-box';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.user.findMany({
      where: { OR: [{ totpSecretEnc: { not: null } }, { totpPendingSecretEnc: { not: null } }] },
      select: { id: true, totpSecretEnc: true, totpPendingSecretEnc: true },
    });
    let sealed = 0;
    for (const u of rows) {
      for (const field of ['totpSecretEnc', 'totpPendingSecretEnc'] as const) {
        const value = u[field];
        if (!value || !isLegacyPlain(value)) continue;
        const { count } = await prisma.user.updateMany({
          where: { id: u.id, [field]: value },
          data: { [field]: sealTotpSecret(value, u.id) },
        });
        sealed += count;
      }
    }
    console.log(`✓ شُفّر ${sealed} سرّاً من ${rows.length} حساباً بتحقق ثنائي.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
