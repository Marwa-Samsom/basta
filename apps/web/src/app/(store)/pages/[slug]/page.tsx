import type { Metadata } from 'next';
import { Icon } from '@/components/icons';
import { getPage } from '@/lib/storefront';

/** «1 سبتمبر 2026» كما في التصميم — أرقام لاتينية، والتاريخ الفاسد لا يُعرض */
function formatUpdated(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** ST-30 — صفحة محتوى من AD-18. مكوّن خادم، والنص يُعرض بفقراته كما كُتب */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await getPage((await params).slug);
  return { title: `${page.titleAr} — بسطة` };
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await getPage((await params).slug);
  const updated = formatUpdated(page.updatedAt);
  return (
    <div className="ac-page">
      <article className="ac-page__article">
        <h1 className="ac-page__title">{page.titleAr}</h1>
        {updated ? (
          <p className="ac-page__updated">
            <Icon name="clock" size={14} />
            <span>
              آخر تحديث <time dateTime={page.updatedAt}>{updated}</time>
            </span>
          </p>
        ) : null}
        <div className="ac-prose">
          {page.bodyAr
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
      </article>
    </div>
  );
}
