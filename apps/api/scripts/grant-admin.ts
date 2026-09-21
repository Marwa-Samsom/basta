/**
 * المدير الأول — العملية الوحيدة التي تسبق لوحة الإدارة، فلا تتمّ منها.
 *
 *   npm run admin:grant -- someone@example.com
 *
 * الشخص ينشئ حسابه من /register بنفسه أولاً (لا كلمة مرور تمرّ بيد أحد)،
 * ثم يمنحه هذا الأمر الدور وكل الصلاحيات. التحقق الثنائي يُفرض عند أول
 * دخول له. بعدها يمنح المديرون غيرهم من AD-23، ولا يُستعمل هذا ثانية.
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
    await prisma.auditLog.create({
      data: { actorUserId: null, action: 'admin.bootstrap', entityType: 'User', entityId: user.id, afterJson: { permissions: [...PERMISSION_CODES] } },
    });
    console.log(`✓ ${email} مدير بكل الصلاحيات. التحقق الثنائي يُطلب عند أول دخول.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
