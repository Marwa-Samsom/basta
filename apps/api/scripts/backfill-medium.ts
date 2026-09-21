/**
 * مقاس الهاتف للصور القائمة — المرحلة 12. الصور المرفوعة قبل إضافة medium
 * تُولَّد لها من full.webp (1600) — لا حاجة للأصل. عديم الأثر عند التكرار.
 *
 *   npm run images:backfill
 */
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_MEDIUM_EDGE, UPLOADS_ROOT } from '../src/modules/catalog/infrastructure/product-images';

async function main(): Promise<void> {
  const root = join(UPLOADS_ROOT, 'products');
  if (!existsSync(root)) return console.log('لا صور.');
  let made = 0;
  for (const product of await readdir(root)) {
    for (const image of await readdir(join(root, product)).catch(() => [] as string[])) {
      const dir = join(root, product, image);
      const full = join(dir, 'full.webp');
      if (!existsSync(full) || existsSync(join(dir, 'medium.avif'))) continue;
      const medium = sharp(full).resize({ width: IMAGE_MEDIUM_EDGE, height: IMAGE_MEDIUM_EDGE, fit: 'inside', withoutEnlargement: true });
      await writeFile(join(dir, 'medium.webp'), await medium.clone().webp({ quality: 78 }).toBuffer());
      await writeFile(join(dir, 'medium.avif'), await medium.clone().avif({ quality: 52, effort: 4 }).toBuffer());
      made++;
    }
  }
  console.log(`✓ ${made} صورة بمقاس الهاتف`);
}

void main();
