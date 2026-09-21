import type { Metadata } from 'next';
import Link from 'next/link';
import { getCategories } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'كل الفئات' };

/** ST-02 — كل الفئات بفروعها. */
export default async function CategoriesPage() {
  const tree = await getCategories();
  return (
    <div className="stack">
      <h1>كل الفئات</h1>
      <div className="cat-grid">
        {tree.map((c) => (
          <section key={c.id} className="card">
            <h2>
              <Link href={`/c/${c.slug}`}>{c.nameAr}</Link>
            </h2>
            {c.children?.length ? (
              <ul className="blockers small">
                {c.children.map((child) => (
                  <li key={child.id}>
                    <Link href={`/c/${child.slug}`}>{child.nameAr}</Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
