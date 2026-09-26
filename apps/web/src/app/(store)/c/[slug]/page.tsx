import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Crumbs, Listing, hasFilters } from '@/components/listing';
import { EmptyState } from '@/components/ui';
import { decodeParam, flatten, getCategories, listProducts, type Category } from '@/lib/storefront';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = decodeParam((await params).slug);
  const category = flatten(await getCategories()).find((c) => c.slug === slug);
  return { title: category?.nameAr ?? 'فئة' };
}

/** سلسلة الآباء من الجذر إلى الفئة — لمسار التصفّح */
function ancestorsOf(category: Category, all: Category[]): Category[] {
  const chain: Category[] = [];
  let parentId = category.parentId;
  while (parentId) {
    const parent = all.find((c) => c.id === parentId);
    if (!parent || chain.includes(parent)) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
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
  const filtered = hasFilters(query);

  return (
    <Listing
      base={`/c/${slug}`}
      params={query}
      result={result}
      title={category.nameAr}
      crumbs={
        <Crumbs
          items={[
            { href: '/', label: 'الرئيسية' },
            { href: '/categories', label: 'الأقسام' },
            ...ancestorsOf(category, all).map((a) => ({ href: `/c/${a.slug}`, label: a.nameAr })),
            { label: category.nameAr },
          ]}
        />
      }
      subcats={
        children.length > 0 ? (
          <nav className="sd-subcats" aria-label="فروع القسم">
            {children.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="sd-subcat">
                {c.nameAr}
              </Link>
            ))}
          </nav>
        ) : null
      }
      empty={
        filtered ? (
          <EmptyState
            icon="filter"
            title="لا نتائج مع هذه التصفية"
            actions={
              <>
                <Link className="btn btn--primary" href={`/c/${slug}`}>
                  امسح التصفية
                </Link>
                <Link className="btn btn--secondary" href="/categories">
                  تصفّح الأقسام
                </Link>
              </>
            }
          >
            لا منتجات في هذه الفئة تطابق التصفية. أزل آخر تصفية أضفتها لترى نتائج أوسع.
          </EmptyState>
        ) : (
          <EmptyState
            icon="filter"
            title="لا منتجات في هذا القسم بعد"
            actions={
              <Link className="btn btn--secondary" href="/categories">
                تصفّح الأقسام
              </Link>
            }
          >
            هذا القسم جديد ولم تُنشر فيه منتجات بعد. تصفّح أقساماً أخرى أو عُد قريباً.
          </EmptyState>
        )
      }
    />
  );
}
