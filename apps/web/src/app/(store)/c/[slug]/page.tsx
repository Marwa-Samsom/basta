import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Listing } from '@/components/listing';
import { decodeParam, flatten, getCategories, listProducts } from '@/lib/storefront';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = decodeParam((await params).slug);
  const category = flatten(await getCategories()).find((c) => c.slug === slug);
  return { title: category?.nameAr ?? 'فئة' };
}

/** ST-03 — قائمة الفئة بأوجه تصفية. تشمل منتجات الفروع كلها تحت الفئة. */
export default async function CategoryPage({ params, searchParams }: Props) {
  const slug = decodeParam((await params).slug);
  const query = await searchParams;
  const all = flatten(await getCategories());
  const category = all.find((c) => c.slug === slug);
  if (!category) notFound();

  const children = all.filter((c) => c.parentId === category.id);
  const result = await listProducts({ ...query, category: slug, q: undefined });

  return (
    <div className="stack">
      <nav className="small muted" aria-label="مسار التصفّح">
        <Link href="/">الرئيسية</Link> · <Link href="/categories">الفئات</Link>
      </nav>
      <h1>{category.nameAr}</h1>

      {children.length > 0 ? (
        <div className="chips">
          {children.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} className="chip">
              {c.nameAr}
            </Link>
          ))}
        </div>
      ) : null}

      <Listing
        base={`/c/${slug}`}
        params={query}
        result={result}
        empty={
          <div className="empty">
            <p>لا منتجات في هذه الفئة تطابق التصفية.</p>
            <Link className="btn btn--secondary" href={`/c/${slug}`}>
              امسح التصفية
            </Link>
          </div>
        }
      />
    </div>
  );
}
