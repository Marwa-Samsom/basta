import type { Metadata } from 'next';
import { getPage } from '@/lib/storefront';

/** صفحة محتوى من AD-18 — مكوّن خادم، والنص يُعرض بفقراته كما كُتب */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await getPage((await params).slug);
  return { title: `${page.titleAr} — بسطة` };
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await getPage((await params).slug);
  return (
    <article className="page stack">
      <h1>{page.titleAr}</h1>
      {page.bodyAr
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {p}
          </p>
        ))}
    </article>
  );
}
