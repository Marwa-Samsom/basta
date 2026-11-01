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
 *
 * الحساب غير النشط (معلَّق أو محذوف) يُرفض برمز 1 ولا يتغيّر شيء. المنطق في
 * grantAdmin (owner-recovery.ts) داخل معاملة واحدة، ويُختبر هناك مع admin:recover.
 */
import { PrismaClient } from '@prisma/client';
import { grantAdmin } from '../src/modules/admin/application/owner-recovery';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('الاستعمال: npm run admin:grant -- <البريد>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const r = await prisma.$transaction((tx) => grantAdmin(tx, { email }));
    console.log(`✓ ${r.email} مدير بكل الصلاحيات${r.madeOwner ? ' ومالك المنصة' : ''}. التحقق الثنائي يُطلب عند أول دخول.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
