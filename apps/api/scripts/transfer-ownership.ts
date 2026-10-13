/**
 * نقل ملكية المنصة إلى مدير آخر.
 *
 *   npm run admin:transfer-owner -- newowner@example.com "تسليم الإدارة إلى ..." --yes
 *
 * المالك وحده محميّ من بقية المديرين ويمنح ما لا يحمله، ولا مكان في اللوحة ينقل
 * هذه الصفة — وإن ضاع حساب المالك ضاعت معه. المستلم مدير نشط بتحقق ثنائي مفعَّل،
 * والمالك السابق يبقى مديراً بصلاحياته. يُكتب في التدقيق بالمالكَين والسبب.
 *
 * يعمل باتصال القاعدة (DATABASE_URL)، وللإنتاج يُمرَّر عنوانها قبل الأمر:
 *   DATABASE_URL="postgresql://…supabase…" npm run admin:transfer-owner -- … --yes
 *
 * بلا --yes يجرّب النقل كاملاً داخل معاملة يتراجع عنها: يعرض ما سيحدث، أو سبب
 * الرفض، ولا يغيّر شيئاً.
 */
import { PrismaClient } from '@prisma/client';
import { RecoveryRefused, transferOwnership, type OwnershipTransfer } from '../src/modules/admin/application/owner-recovery';

class DryRun extends Error {
  constructor(readonly result: OwnershipTransfer) {
    super('dry run');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const [toEmail, reason] = args.filter((a) => a !== '--yes');
  if (!toEmail || !reason) {
    console.error('الاستعمال: npm run admin:transfer-owner -- <بريد المالك الجديد> "<السبب>" --yes');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    if (!confirmed) {
      const dry = await prisma
        .$transaction(async (tx) => {
          throw new DryRun(await transferOwnership(tx, { toEmail, reason }));
        })
        .catch((e: unknown) => e);
      if (!(dry instanceof DryRun)) throw dry;
      console.log(
        [
          `ستنتقل ملكية المنصة: ${dry.result.from ?? '(لا مالك الآن)'} ← ${dry.result.to}`,
          '  · المالك السابق يبقى مديراً بصلاحياته، ولا يعود محمياً من بقية المديرين',
          '',
          'لم يتغيّر شيء. أعد الأمر ومعه --yes للتنفيذ.',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }
    const r = await prisma.$transaction((tx) => transferOwnership(tx, { toEmail, reason }));
    console.log(`✓ الملكية انتقلت: ${r.from ?? '(لا مالك)'} ← ${r.to}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: Error) => {
  console.error(e instanceof RecoveryRefused ? `✗ ${e.message}` : e.message);
  process.exit(1);
});
