import type { Metadata } from 'next';
import Link from 'next/link';
import { Listing } from '@/components/listing';
import { getCategories, listProducts } from '@/lib/storefront';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  // نتائج البحث لا تُفهرس: كل كلمة صفحة، والصفحات الرقيقة تضرّ بترتيب الموقع
  return { title: q ? `بحث: ${q}` : 'بحث', robots: { index: false, follow: true } };
}

/**
 * ST-04 نتائج البحث، و ST-05 بلا نتائج.
 *
 * «بلا نتائج» ليست طريقاً مسدوداً: تقترح الفئات وتقول ما يمكن تجربته،
 * لأن المشتري الذي يُترك أمام صفحة فارغة يغادر.
 */
export default async function SearchPage({ searchParams }: Props) {
  const query = await searchParams;
  const q = query['q']?.trim() ?? '';

  if (!q) {
    return (
      <div className="empty">
        <p>اكتب ما تبحث عنه في الأعلى — اسم منتج، أو ماركة، أو متجر.</p>
      </div>
    );
  }

  const [result, categories] = await Promise.all([listProducts(query), getCategories()]);

  return (
    <div className="stack">
      <h1>نتائج «{q}»</h1>
      <Listing
        base="/search"
        params={query}
        result={result}
        empty={
          <div className="empty">
            <p>لم نجد منتجاً يطابق «{q}».</p>
            <ul className="blockers small">
              <li>جرّب كلمة أعمّ: «قميص» بدل «قميص قطني أزرق مقاس M».</li>
              <li>الأخطاء الإملائية والهمزات مقبولة، والمرادفات الشائعة كذلك.</li>
            </ul>
            <div className="chips">
              {categories.map((c) => (
                <Link key={c.id} href={`/c/${c.slug}`} className="chip">
                  {c.nameAr}
                </Link>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
