import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { getCategories, type Category } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'كل الأقسام' };

/**
 * عقدة في الشجرة. ذات الفروع `<details>` تتوسّع بلا سكربت، وأوّل ما فيها
 * رابط القسم نفسه — فالقسم الأب يُفتح كما تُفتح فروعه. والورقة رابط مباشر.
 */
function Node({ node }: { node: Category }) {
  const top = node.depth === 0;
  const icon = top ? (
    <span className="sd-tree__icon" aria-hidden>
      <Icon name="boxes" size={18} />
    </span>
  ) : null;

  if (!node.children?.length) {
    return (
      <Link href={`/c/${node.slug}`} className="sd-tree__row" data-depth={node.depth}>
        {icon}
        <span className="sd-tree__name">{node.nameAr}</span>
        <Icon name="chev-end" size={15} mirror className="sd-tree__go" />
      </Link>
    );
  }

  return (
    <details className="sd-tree__group">
      <summary className="sd-tree__row" data-depth={node.depth}>
        {icon}
        <span className="sd-tree__name">{node.nameAr}</span>
        <Icon name="chev-down" size={16} className="sd-tree__chev" />
      </summary>
      <Link href={`/c/${node.slug}`} className="sd-tree__row sd-tree__all" data-depth={node.depth + 1}>
        <span className="sd-tree__name">كل {node.nameAr}</span>
        <Icon name="chev-end" size={15} mirror className="sd-tree__go" />
      </Link>
      {node.children.map((child) => (
        <Node key={child.id} node={child} />
      ))}
    </details>
  );
}

/** ST-02 — كل الفئات بفروعها. */
export default async function CategoriesPage() {
  const tree = await getCategories();
  return (
    <div className="sd-cats">
      <div className="page-head">
        <h1>كل الأقسام</h1>
        <span className="page-head__meta">اضغط القسم ليتوسّع</span>
      </div>
      {tree.length > 0 ? (
        <nav className="sd-tree" aria-label="شجرة الأقسام">
          {tree.map((c) => (
            <Node key={c.id} node={c} />
          ))}
        </nav>
      ) : (
        <EmptyState icon="boxes" title="لا أقسام بعد">
          تُضاف الأقسام من لوحة الإدارة، وتظهر هنا حال نشرها.
        </EmptyState>
      )}
    </div>
  );
}
