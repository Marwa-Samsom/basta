/**
 * كل مسار إداري بصلاحية — حارس بنيوي لا اختبار حالة.
 *
 * `GET admin/orders/:number` كان بالدور وحده، فيقرأ أي مدير — تسويق أو محتوى —
 * عنوان أي مشترٍ وحالة دفعه برقم الطلب. سُدّ، وهذا يمنع أن يعود في مسار جديد:
 * يمرّ على كل متحكّم في التطبيق، وكل مسار تحت `admin` بلا RequirePermission
 * (على الدالة أو الصنف) يُسقط الاختبار — إلا ما في القائمة أدناه بسببه المكتوب.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { REQUIRED_PERMISSION } from '../../common/security/decorators';

/** مفتوح لكل مدير عمداً — كل سطر بسببه */
const OPEN_TO_EVERY_ADMIN: Record<string, string> = {
  // الطوابير تخصّ الجميع؛ الأرقام المالية داخلها لمن يملك reports.view وحده
  'GET admin/dashboard': 'اللوحة الرئيسية',
  // أسماء الصلاحيات وتسمياتها — ثابتة في الكود، بلا بيانات
  'GET admin/permissions': 'قائمة الصلاحيات',
};

const join = (...parts: (string | undefined)[]) =>
  parts
    .flatMap((p) => (p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

describe('كل مسار إداري يطلب صلاحية', () => {
  it('لا مسار تحت admin بالدور وحده إلا ما هو مفتوح عمداً', async () => {
    const [{ Test }, { AppModule }] = await Promise.all([import('@nestjs/testing'), import('../../app.module')]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    const controllers = moduleRef.get(DiscoveryService).getControllers();

    const unguarded: string[] = [];
    let adminRoutes = 0;
    for (const wrapper of controllers) {
      const cls = wrapper.metatype as (new (...a: never[]) => object) | undefined;
      if (!cls) continue;
      const base = Reflect.getMetadata(PATH_METADATA, cls) as string | string[] | undefined;
      const basePath = Array.isArray(base) ? base[0] : base;
      const classPerm = Reflect.getMetadata(REQUIRED_PERMISSION, cls) as string | undefined;
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = (cls.prototype as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        if (path === undefined) continue;
        const full = join(basePath, Array.isArray(path) ? path[0] : path);
        if (!full.startsWith('admin')) continue;
        adminRoutes++;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const key = `${method} ${full}`;
        const perm = (Reflect.getMetadata(REQUIRED_PERMISSION, handler) as string | undefined) ?? classPerm;
        if (!perm && !(key in OPEN_TO_EVERY_ADMIN)) unguarded.push(key);
      }
    }

    // الحارس لا يمرّ فارغاً: لو تغيّر شكل البيانات الوصفية لرأى صفراً ونجح كذباً
    expect(adminRoutes).toBeGreaterThan(50);
    expect(unguarded, `مسارات إدارية بلا صلاحية:\n${unguarded.join('\n')}`).toEqual([]);
  }, 60_000);
});
