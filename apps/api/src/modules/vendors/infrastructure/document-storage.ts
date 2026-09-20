import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * مخزن وثائق البائع.
 *
 * **ليس `uploads/`.** صور المنتجات محتوى عام يُخدم برابط مباشر بلا مصادقة،
 * ووثائق البائع هوية شخصية وسجل تجاري وكشف بنكي. لو عاشت في المجلد نفسه
 * لكفى تسريب مفتاح واحد لفتحها للعالم. هنا مجلد منفصل **لا يخدمه
 * `@fastify/static` إطلاقاً**، والقراءة تمرّ بمسار مصادَق يتحقّق من الملكية.
 */
export const DOCUMENTS_ROOT = resolve(
  process.cwd(),
  process.env['VENDOR_DOCUMENTS_DIR'] ?? 'private/vendor-documents',
);

/** المفتاح نركّبه من معرّفات، والحارس يبقى: `..` يكتب خارج المجلد */
const SAFE_KEY = /^[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}$/;

@Injectable()
export class VendorDocumentStorage {
  readonly root = DOCUMENTS_ROOT;

  private path(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`مفتاح تخزين غير آمن: ${key}`);
    return join(this.root, ...key.split('/'));
  }

  /** كتابة ثم إعادة تسمية: قارئ متزامن لا يرى ملفاً نصف مكتوب */
  async save(key: string, buffer: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(join(target, '..'), { recursive: true });
    const temp = `${target}.tmp`;
    await writeFile(temp, buffer);
    await rename(temp, target);
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
