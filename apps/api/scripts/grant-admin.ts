/**
 * المدير الأول — العملية الوحيدة التي تسبق لوحة الإدارة، فلا تتمّ منها.
 *
 *   npm run admin:grant -- someone@example.com
 *
 * الشخص ينشئ حسابه من /register بنفسه أولاً (لا كلمة مرور تمرّ بيد أحد)،
 * ثم يمنحه هذا الأمر الدور وكل الصلاحيات. التحقق الثنائي يُفرض عند أول
 * دخول له. بعدها يمنح المديرون غيرهم من AD-23، ولا يُستعمل هذا ثانية.
 *
 * المدير الأول **مالك المنصة** إن لم يكن لها مالك: لا يغيّر صلاحياته ولا يسحب
 * إدارته مدير آخر، وهو وحده يمنح ما لا يحمله المانح. تشغيل الأمر لحساب ثانٍ
 * يعطيه الإدارة والصلاحيات ولا يجعله مالكاً.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CODES } from '../src/modules/admin/domain/permissions';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('الاستعمال: npm run admin:grant -- <البريد>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
    if (!user) throw new Error(`لا حساب بالبريد ${email} — أنشئه من /register أولاً.`);
    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role: 'admin' } },
      create: { userId: user.id, role: 'admin' },
      update: {},
    });
    await prisma.adminPermission.createMany({
      data: PERMISSION_CODES.map((permission) => ({ userId: user.id, permission })),
      skipDuplicates: true,
    });
    const owner = await prisma.user.findFirst({ where: { isPlatformOwner: true }, select: { id: true } });
    if (!owner) await prisma.user.update({ where: { id: user.id }, data: { isPlatformOwner: true } });
    await prisma.auditLog.create({
      data: { actorUserId: null, action: 'admin.bootstrap', entityType: 'User', entityId: user.id, afterJson: { permissions: [...PERMISSION_CODES] } },
    });
    console.log(`✓ ${email} مدير بكل الصلاحيات${owner ? '' : ' ومالك المنصة'}. التحقق الثنائي يُطلب عند أول دخول.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
