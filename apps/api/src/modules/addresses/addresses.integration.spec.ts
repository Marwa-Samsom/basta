/**
 * ST-26 · دفتر العناوين، و ST-27 · تصفّح صندوق الإشعارات — عبر الواجهة البرمجية الحيّة.
 *
 * ما يُثبَت:
 *   1. العنوان الأول افتراضي تلقائياً، وتعيين افتراضي جديد يمسح القديم، وحذف
 *      الافتراضي يرفع غيره، والاسترجاع لا يصنع افتراضياً ثانياً.
 *   2. **عزل المالك**: مستخدم لا يقرأ عنوان غيره ولا يعدّله ولا يحذفه ولا
 *      يجعله افتراضياً ولا يسترجعه — 404 كالمعرّف غير الموجود، والصف لم يتغيّر.
 *   3. **افتراضي واحد تحت التزامن**: جولات من «اجعله الافتراضي» المتوازية على
 *      عناوين مختلفة تنتهي كل مرة بافتراضي واحد بالضبط. قفل صف المستخدم هو
 *      الحارس، ونزعه يجب أن يُسقط هذا الاختبار (اختبار طفرة).
 *   4. صندوق الإشعارات: بلا معاملات يعود كما كان (الجرس)، والصفحات بالمؤشّر
 *      لا تكرّر ولا تُسقط، وتصفية غير المقروء، ومؤشّر مستخدم آخر لا يفتح شيئاً.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `addr${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

const alice = { userId: '', token: '' };
const bob = { userId: '', token: '' };

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token?: string, body?: unknown): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function makeUser(tag: string) {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: { email, fullName: `مشترٍ ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
  expect(res.statusCode, res.body).toBe(200);
  return { userId: u.id, token: res.json().tokens.accessToken as string };
}

const addr = (label: string, extra: Record<string, unknown> = {}) => ({
  label,
  recipientName: 'نورة العتيبي',
  phone: '+966 55 012 8844',
  country: 'sa',
  region: 'منطقة الرياض',
  city: 'الرياض',
  area: 'حي النرجس',
  street: 'شارع أنس بن مالك',
  building: 'مبنى 24',
  floor: '3',
  ...extra,
});

async function create(user: { token: string }, label: string, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/me/addresses', user.token, addr(label, extra));
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; isDefault: boolean; country: string };
}

const defaultsOf = (userId: string) => prisma.address.count({ where: { userId, deletedAt: null, isDefault: true } });

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات العناوين متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  Object.assign(alice, await makeUser('alice'));
  Object.assign(bob, await makeUser('bob'));
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (dbUp) {
    // العناوين والإشعارات تسقط مع أصحابها (onDelete: Cascade)؛ ما يرفض الحذف يبقى بلا ضرر
    await prisma.user.deleteMany({ where: { id: { in: [alice.userId, bob.userId].filter(Boolean) } } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('ST-26 · دفتر العناوين', () => {
  it('بلا دخول: 401', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/me/addresses')).statusCode).toBe(401);
    expect((await call('POST', '/me/addresses', undefined, addr('المنزل'))).statusCode).toBe(401);
  });

  it('الأول افتراضي تلقائياً، والجديد الافتراضي يمسح القديم، والقائمة تبدأ بالافتراضي', async () => {
    if (!dbUp) return;
    const home = await create(alice, 'المنزل');
    expect(home.isDefault).toBe(true);
    expect(home.country).toBe('SA');

    const work = await create(alice, 'العمل');
    expect(work.isDefault).toBe(false);
    expect(await defaultsOf(alice.userId)).toBe(1);

    const family = await create(alice, 'منزل العائلة', { isDefault: true });
    expect(family.isDefault).toBe(true);
    expect(await defaultsOf(alice.userId)).toBe(1);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: home.id } })).isDefault).toBe(false);

    const list = await call('GET', '/me/addresses', alice.token);
    expect(list.statusCode).toBe(200);
    const items = list.json().items as { id: string; isDefault: boolean }[];
    expect(items).toHaveLength(3);
    expect(items[0]!.id).toBe(family.id);

    // «اجعله الافتراضي» يمسح القديم
    const set = await call('POST', `/me/addresses/${work.id}/default`, alice.token);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().isDefault).toBe(true);
    expect(await defaultsOf(alice.userId)).toBe(1);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: family.id } })).isDefault).toBe(false);
  });

  it('التعديل يحفظ الحقول، والفراغ يمسح الاختياري، وحقل غير معروف يُرفض', async () => {
    if (!dbUp) return;
    const a = await create(alice, 'مؤقت');
    const r = await call('PATCH', `/me/addresses/${a.id}`, alice.token, { city: 'جدة', floor: '' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ city: 'جدة', floor: null, label: 'مؤقت' });
    const bad = await call('PATCH', `/me/addresses/${a.id}`, alice.token, { userId: bob.userId });
    expect(bad.statusCode).toBe(400);
    const phone = await call('PATCH', `/me/addresses/${a.id}`, alice.token, { phone: 'abc' });
    expect(phone.statusCode).toBe(400);
    expect((await call('DELETE', `/me/addresses/${a.id}`, alice.token)).statusCode).toBe(204);
  });

  it('حذف الافتراضي يرفع غيره، والاسترجاع يعيده غير افتراضي', async () => {
    if (!dbUp) return;
    const current = await prisma.address.findFirstOrThrow({ where: { userId: alice.userId, deletedAt: null, isDefault: true } });
    const del = await call('DELETE', `/me/addresses/${current.id}`, alice.token);
    expect(del.statusCode, del.body).toBe(204);
    const gone = await prisma.address.findUniqueOrThrow({ where: { id: current.id } });
    expect(gone.deletedAt).not.toBeNull(); // حذف ناعم
    expect(gone.isDefault).toBe(false);
    expect(await defaultsOf(alice.userId)).toBe(1);
    expect(((await call('GET', '/me/addresses', alice.token)).json().items as { id: string }[]).map((i) => i.id)).not.toContain(current.id);
    // المحذوف لا يُعدَّل ولا يصير افتراضياً
    expect((await call('PATCH', `/me/addresses/${current.id}`, alice.token, { city: 'x' })).statusCode).toBe(404);
    expect((await call('POST', `/me/addresses/${current.id}/default`, alice.token)).statusCode).toBe(404);

    const back = await call('POST', `/me/addresses/${current.id}/restore`, alice.token);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().isDefault).toBe(false);
    expect(await defaultsOf(alice.userId)).toBe(1);
    // لا يُسترجع مرتين
    expect((await call('POST', `/me/addresses/${current.id}/restore`, alice.token)).statusCode).toBe(404);
  });

  it('حذف العنوان الوحيد لا يترك افتراضياً معلّقاً، والعنوان التالي يصير افتراضياً', async () => {
    if (!dbUp) return;
    const only = await create(bob, 'الوحيد');
    expect(only.isDefault).toBe(true);
    expect((await call('DELETE', `/me/addresses/${only.id}`, bob.token)).statusCode).toBe(204);
    expect(await defaultsOf(bob.userId)).toBe(0);
    const next = await create(bob, 'التالي');
    expect(next.isDefault).toBe(true);
  });
});

describe('ST-26 · عزل المالك', () => {
  it('مستخدم لا يقرأ عنوان غيره ولا يعدّله ولا يحذفه ولا يجعله افتراضياً ولا يسترجعه', async () => {
    if (!dbUp) return;
    const target = await create(alice, 'سرّي', { street: 'شارع لا يراه غيري' });
    const before = await prisma.address.findUniqueOrThrow({ where: { id: target.id } });

    const reads = [
      await call('GET', `/me/addresses/${target.id}`, bob.token),
      await call('PATCH', `/me/addresses/${target.id}`, bob.token, { street: 'اختطاف العنوان' }),
      await call('POST', `/me/addresses/${target.id}/default`, bob.token),
      await call('DELETE', `/me/addresses/${target.id}`, bob.token),
    ];
    for (const r of reads) {
      expect(r.statusCode, r.body).toBe(404);
      expect(r.body).not.toContain('شارع لا يراه غيري');
    }
    const bobList = (await call('GET', '/me/addresses', bob.token)).json().items as { id: string }[];
    expect(bobList.map((i) => i.id)).not.toContain(target.id);

    const after = await prisma.address.findUniqueOrThrow({ where: { id: target.id } });
    expect(after).toEqual(before);

    // المحذوف لصاحبه لا يسترجعه غيره
    expect((await call('DELETE', `/me/addresses/${target.id}`, alice.token)).statusCode).toBe(204);
    expect((await call('POST', `/me/addresses/${target.id}/restore`, bob.token)).statusCode).toBe(404);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).not.toBeNull();
  });
});

describe('ST-26 · افتراضي واحد تحت التزامن', () => {
  it('جولات «اجعله الافتراضي» المتوازية على عناوين مختلفة تنتهي بافتراضي واحد', async () => {
    if (!dbUp) return;
    const racer = await makeUser('racer');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await create(racer, `ع${i}`)).id);

    for (let round = 0; round < 6; round++) {
      // كل عنوان يُطلب افتراضياً مرتين معاً — عشرة طلبات متزامنة
      const results = await Promise.all([...ids, ...ids].map((id) => call('POST', `/me/addresses/${id}/default`, racer.token)));
      expect(results.map((r) => r.statusCode)).toEqual(results.map(() => 200));
      expect(await defaultsOf(racer.userId)).toBe(1);
    }
    // وإضافة عنوان افتراضي مع تعيين غيره في اللحظة نفسها
    const mixed = await Promise.all([
      call('POST', '/me/addresses', racer.token, addr('متزامن', { isDefault: true })),
      call('POST', `/me/addresses/${ids[0]}/default`, racer.token),
      call('POST', `/me/addresses/${ids[1]}/default`, racer.token),
    ]);
    expect(mixed.map((r) => r.statusCode)).toEqual([201, 200, 200]);
    expect(await defaultsOf(racer.userId)).toBe(1);
    await prisma.user.delete({ where: { id: racer.userId } }).catch(() => undefined);
  });
});

describe('ST-27 · تصفّح صندوق الإشعارات', () => {
  it('بلا معاملات كما كان، والصفحات بالمؤشّر كاملة بلا تكرار، وتصفية غير المقروء', async () => {
    if (!dbUp) return;
    const base = Date.now() - 60 * 60_000;
    // خمسة إشعارات لأليس، اثنان منها بالوقت نفسه (مساواة الوقت تُحسم بالمعرّف)، وثلاثة مقروءة
    const stamps = [0, 1, 2, 2, 3].map((m) => new Date(base + m * 60_000));
    await prisma.notification.createMany({
      data: stamps.map((createdAt, i) => ({
        userId: alice.userId,
        channel: 'in_app',
        templateCode: 'order_status_changed',
        payloadJson: { link: `/account/orders/T-${i}` },
        status: 'sent',
        body: `إشعار ${i}`,
        createdAt,
        readAt: i < 3 ? new Date() : null,
      })),
    });
    // إشعار لبوب — لا يظهر لأليس، ومعرّفه لا يصلح مؤشّراً لها
    const bobs = await prisma.notification.create({
      data: { userId: bob.userId, channel: 'in_app', templateCode: 'order_placed', payloadJson: {}, status: 'sent', body: 'لبوب' },
    });

    const plain = await call('GET', '/me/notifications', alice.token);
    expect(plain.statusCode).toBe(200);
    const all = plain.json() as { unread: number; items: { id: string; body: string; link: string }[]; nextCursor: string | null };
    expect(all.unread).toBe(2);
    expect(all.items).toHaveLength(5);
    expect(all.nextCursor).toBeNull();
    expect(all.items[0]!.body).toBe('إشعار 4');
    expect(all.items.map((i) => i.body)).not.toContain('لبوب');

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await call('GET', `/me/notifications?limit=2${cursor ? `&before=${cursor}` : ''}`, alice.token);
      expect(r.statusCode, r.body).toBe(200);
      const page = r.json() as { items: { id: string }[]; nextCursor: string | null };
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(all.items.map((i) => i.id));

    const unread = (await call('GET', '/me/notifications?unread=1', alice.token)).json() as { items: { body: string }[] };
    expect(unread.items.map((i) => i.body)).toEqual(['إشعار 4', 'إشعار 3']);

    expect((await call('GET', `/me/notifications?before=${bobs.id}`, alice.token)).statusCode).toBe(404);
    expect((await call('GET', '/me/notifications?limit=500', alice.token)).statusCode).toBe(400);
    expect((await call('GET', '/me/notifications?before=not-a-uuid', alice.token)).statusCode).toBe(400);
  });
});
