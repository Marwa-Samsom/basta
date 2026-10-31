import type { SubOrderStatus } from './state-machine';

/**
 * صلاحية الانتقال الإداري فوق orders.manage التي تفتح الطلب. الإلغاء يردّ مال المشتري فله صلاحيته
 * وحدها — من مساره ومن الانتقال العام، وزرّه لمن يحملها فقط (ADM-062، 31 أكتوبر 2026).
 */
const REQUIRED: Readonly<Partial<Record<SubOrderStatus, string>>> = {
  canceled_by_admin: 'orders.cancel',
};

/** الصلاحية الناقصة لهذا الانتقال، أو null إن كانت عنده */
export function missingAdminPermission(to: SubOrderStatus, permissions: readonly string[]): string | null {
  const need = REQUIRED[to];
  return need && !permissions.includes(need) ? need : null;
}
