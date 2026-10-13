import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/public';

/**
 * طريق الخروج من قفل الإدارة — من خارج اللوحة، بمن يملك اتصال القاعدة.
 *
 * التحقق الثنائي إلزامي على حسابات الإدارة، ولا يُنزع من اللوحة (SRS A-07)، والمالك
 * محميّ من بقية المديرين. فمدير أضاع هاتف المصادقة **ورموز الاستعادة معاً** — والمالك
 * أولهم، ولعله المدير الوحيد — كان لا يعود إلى حسابه أبداً، ولا تُنقل الملكية. صاحب
 * اتصال القاعدة (DATABASE_URL) يملك المنصة فعلاً، فهو الإثبات هنا.
 *
 * الدالتان تعملان داخل معاملة يمرّرها المستدعي: الأمر يلتزمها، والاختبار يتراجع عنها
 * (الملكية واحدة في القاعدة كلها). وكلتاهما تكتب سطراً في التدقيق بسبب إلزامي.
 */

export class RecoveryRefused extends Error {}

const normalized = (email: string) => email.trim().toLowerCase();

function reasonOf(reason: string): string {
  const why = reason.trim();
  if (why.length < 10) throw new RecoveryRefused('اكتب سبباً واضحاً (10 أحرف فأكثر) — يُثبت في سجل التدقيق.');
  return why;
}

export interface TotpRecovery {
  readonly userId: string;
  readonly email: string;
  readonly isOwner: boolean;
  readonly codesRemoved: number;
  readonly sessionsEnded: number;
}

/**
 * يمسح سرّ التحقق الثنائي ورموز الاستعادة لحساب إدارة، ويُنهي كل جلساته. الدخول
 * التالي بكلمة المرور يُلزمه بتفعيل التحقق من جديد (رمز محدود لا يفتح إلا صفحته)،
 * فلا يبقى مدير بلا تحقق. ويُبلَّغ صاحب الحساب — إن لم يطلبه هو عرف فوراً.
 */
export async function recoverAdminTotp(
  tx: Prisma.TransactionClient,
  input: { email: string; reason: string },
): Promise<TotpRecovery> {
  const why = reasonOf(input.reason);
  const email = normalized(input.email);
  const user = await tx.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true, isPlatformOwner: true, roles: { select: { role: true } } },
  });
  if (!user || user.deletedAt) throw new RecoveryRefused(`لا حساب بالبريد ${email}.`);
  if (!user.roles.some((r) => r.role === 'admin')) {
    throw new RecoveryRefused('ليس حساب إدارة — تحقق العملاء يعيد الدعم ضبطه من لوحة الإدارة (العملاء).');
  }

  await tx.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null },
  });
  const codes = await tx.totpRecoveryCode.deleteMany({ where: { userId: user.id } });
  const sessions = await tx.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: null,
      action: 'admin.totp_recovered',
      entityType: 'User',
      entityId: user.id,
      afterJson: { reason: why, via: 'cli', owner: user.isPlatformOwner },
    },
  });
  // الإدراج وحده يحتاج اتصالاً — الإرسال على الخادم بالمرسِل الدوري
  await new NotificationsService(tx as unknown as PrismaService).enqueue(
    { code: 'totp_reset_by_admin', userId: user.id, vars: { reason: why } },
    tx,
  );

  return { userId: user.id, email, isOwner: user.isPlatformOwner, codesRemoved: codes.count, sessionsEnded: sessions.count };
}

export interface OwnershipTransfer {
  readonly from: string | null;
  readonly to: string;
}

/**
 * ينقل ملكية المنصة إلى مدير آخر. المالك السابق يبقى مديراً بصلاحياته، ولا يعود
 * محميّاً من غيره. المستلم مدير نشط **بتحقق ثنائي مفعَّل**: لا تُسلَّم المنصة لحساب
 * تفتحه كلمة مرور وحدها. الفهرس الفريد يُبقي المالك واحداً — الإنزال قبل الرفع.
 */
export async function transferOwnership(
  tx: Prisma.TransactionClient,
  input: { toEmail: string; reason: string },
): Promise<OwnershipTransfer> {
  const why = reasonOf(input.reason);
  const email = normalized(input.toEmail);
  const target = await tx.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      status: true,
      deletedAt: true,
      totpEnabledAt: true,
      isPlatformOwner: true,
      roles: { select: { role: true } },
    },
  });
  if (!target || target.deletedAt) throw new RecoveryRefused(`لا حساب بالبريد ${email}.`);
  if (target.isPlatformOwner) throw new RecoveryRefused(`${email} هو مالك المنصة أصلاً.`);
  if (!target.roles.some((r) => r.role === 'admin')) {
    throw new RecoveryRefused(`${email} ليس مديراً — امنحه الإدارة أولاً (npm run admin:grant -- ${email}).`);
  }
  if (target.status !== 'active') throw new RecoveryRefused(`حساب ${email} غير نشط.`);
  if (!target.totpEnabledAt) {
    throw new RecoveryRefused(`${email} لم يفعّل تحققه الثنائي — يدخل ويفعّله أولاً، ثم تُنقل إليه الملكية.`);
  }

  const current = await tx.user.findFirst({ where: { isPlatformOwner: true }, select: { id: true, email: true } });
  if (current) await tx.user.update({ where: { id: current.id }, data: { isPlatformOwner: false } });
  await tx.user.update({ where: { id: target.id }, data: { isPlatformOwner: true } });
  await tx.auditLog.create({
    data: {
      actorUserId: null,
      action: 'admin.ownership_transferred',
      entityType: 'User',
      entityId: target.id,
      beforeJson: { owner: current?.email ?? null },
      afterJson: { owner: email, reason: why, via: 'cli' },
    },
  });
  return { from: current?.email ?? null, to: email };
}
