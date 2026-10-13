/**
 * مدير — والمالك أولهم — أضاع هاتف المصادقة **ورموز الاستعادة معاً**.
 *
 *   npm run admin:recover -- someone@example.com "فقدتُ هاتفي ورموز الاستعادة في ..." --yes
 *
 * يمسح سرّ التحقق الثنائي ورموز الاستعادة، ويُنهي كل الجلسات، ويكتب في التدقيق، ويبلّغ
 * صاحب الحساب. الدخول التالي بكلمة المرور يُلزمه بتفعيل التحقق من جديد. كلمة المرور
 * نفسها لا تُمسّ — نسيانها له «نسيت كلمة المرور» بالبريد.
 *
 * يعمل باتصال القاعدة (DATABASE_URL): من يملكه يملك المنصة فعلاً، فهو الإثبات. للإنتاج
 * يُمرَّر عنوانها قبل الأمر ويسبق .env:
 *   DATABASE_URL="postgresql://…supabase…" npm run admin:recover -- … --yes
 *
 * بلا --yes يجرّب العملية كاملة داخل معاملة يتراجع عنها: يعرض ما سيحدث، أو سبب
 * الرفض، ولا يغيّر شيئاً.
 */
import { PrismaClient } from '@prisma/client';
import { RecoveryRefused, recoverAdminTotp, type TotpRecovery } from '../src/modules/admin/application/owner-recovery';

class DryRun extends Error {
  constructor(readonly result: TotpRecovery) {
    super('dry run');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const [email, reason] = args.filter((a) => a !== '--yes');
  if (!email || !reason) {
    console.error('الاستعمال: npm run admin:recover -- <البريد> "<السبب: ماذا حدث ومتى>" --yes');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    if (!confirmed) {
      const dry = await prisma
        .$transaction(async (tx) => {
          throw new DryRun(await recoverAdminTotp(tx, { email, reason }));
        })
        .catch((e: unknown) => e);
      if (!(dry instanceof DryRun)) throw dry;
      const r = dry.result;
      console.log(
        [
          `سيحدث لحساب ${r.email}${r.isOwner ? ' (مالك المنصة)' : ''}:`,
          `  · يُمسح سرّ التحقق الثنائي و${r.codesRemoved} رموز استعادة`,
          `  · تُنهى ${r.sessionsEnded} جلسات مفتوحة على كل الأجهزة`,
          '  · يُكتب في سجل التدقيق بالسبب، ويُبلَّغ صاحب الحساب بالبريد وداخل الموقع',
          '  · الدخول التالي بكلمة المرور يطلب تفعيل التحقق من جديد',
          '',
          'لم يتغيّر شيء. أعد الأمر ومعه --yes للتنفيذ.',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }

    const r = await prisma.$transaction((tx) => recoverAdminTotp(tx, { email, reason }));
    console.log(
      [
        `✓ ${r.email}${r.isOwner ? ' (مالك المنصة)' : ''}: مُسح التحقق الثنائي و${r.codesRemoved} رموز استعادة، وأُنهيت ${r.sessionsEnded} جلسات.`,
        '',
        'التالي:',
        '  1. ادخل من /login بكلمة المرور — تُفتح صفحة تفعيل التحقق وحدها.',
        '  2. فعّله على الهاتف الجديد، واحفظ رموز الاستعادة الجديدة بعيداً عن الهاتف (ورقة، مدير كلمات مرور).',
        '  3. إن كنت المدير الوحيد فامنح مديراً احتياطياً الآن — قفلٌ ثانٍ لا يحتاج هذا الأمر.',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: Error) => {
  console.error(e instanceof RecoveryRefused ? `✗ ${e.message}` : e.message);
  process.exit(1);
});
