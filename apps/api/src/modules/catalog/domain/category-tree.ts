/**
 * شجرة الفئات بمسار مادّي — ERD §3.
 *
 * المسار "/<أب>/<ابن>/" يجعل «كل منتجات الفرع» استعلاماً واحداً بـ LIKE على
 * البادئة، و «سمات الفئة وأسلافها» استعلاماً واحداً بـ IN على بادئات المسار.
 * الثمن أن نقل فئة يعيد كتابة مسارات فرعها — عملية إدارية نادرة.
 */
import { InvalidInputError } from '../../../common/errors/domain-error';

/** أربعة مستويات: قسم ← فئة ← فئة فرعية ← نوع. أعمق من ذلك يُضيع المشتري لا يرشده */
export const MAX_CATEGORY_DEPTH = 4;

export interface TreePlacement {
  readonly path: string;
  readonly depth: number;
}

export function placementUnder(parent: TreePlacement | null, id: string): TreePlacement {
  const depth = parent ? parent.depth + 1 : 0;
  if (depth >= MAX_CATEGORY_DEPTH) {
    throw new InvalidInputError(
      `الشجرة بحد أقصى ${MAX_CATEGORY_DEPTH} مستويات، والفئة الأب في المستوى الأخير.`,
    );
  }
  return { path: `${parent ? parent.path : '/'}${id}/`, depth };
}

/** بادئات المسار من الجذر حتى الفئة نفسها: "/a/b/" ← ["/a/", "/a/b/"] */
export function ancestorPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.map((_, i) => `/${parts.slice(0, i + 1).join('/')}/`);
}

export interface MovePlan {
  readonly oldPrefix: string;
  readonly newPrefix: string;
  readonly depthShift: number;
}

/**
 * نقل فئة بفرعها كاملاً.
 * `subtreeMaxDepth` أعمق مستوى في الفرع — النقل يُرفض إن دفعه خارج الحد.
 */
export function planMove(
  node: { readonly id: string; readonly path: string; readonly depth: number },
  newParent: TreePlacement | null,
  subtreeMaxDepth: number,
): MovePlan {
  if (newParent && newParent.path.startsWith(node.path)) {
    throw new InvalidInputError('لا تُنقل فئة تحت نفسها أو تحت أحد فروعها.');
  }
  const newDepth = newParent ? newParent.depth + 1 : 0;
  const depthShift = newDepth - node.depth;
  if (subtreeMaxDepth + depthShift >= MAX_CATEGORY_DEPTH) {
    throw new InvalidInputError(
      `النقل يجعل أعمق فروع هذه الفئة في المستوى ${subtreeMaxDepth + depthShift + 1}، والحد ${MAX_CATEGORY_DEPTH}.`,
    );
  }
  return {
    oldPrefix: node.path,
    newPrefix: `${newParent ? newParent.path : '/'}${node.id}/`,
    depthShift,
  };
}

export type TreeNode<T> = T & { children: TreeNode<T>[] };

/** يبني الشجرة من صفوف مسطّحة. الأيتام (أب غير موجود أو معطّل) يُسقطون لا يُرفعون للجذر. */
export function buildTree<T extends { id: string; parentId: string | null; sort: number }>(
  rows: readonly T[],
): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  const roots: TreeNode<T>[] = [];
  for (const node of nodes.values()) {
    if (node.parentId === null) roots.push(node);
    else nodes.get(node.parentId)?.children.push(node);
  }

  const sortRec = (list: TreeNode<T>[]): TreeNode<T>[] => {
    list.sort((a, b) => a.sort - b.sort);
    for (const n of list) sortRec(n.children);
    return list;
  };
  return sortRec(roots);
}
