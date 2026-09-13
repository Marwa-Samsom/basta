/**
 * المعرّف النصّي للمنتج في الرابط.
 * من الاسم الإنجليزي إن وُجد، وإلا «product» — والذيل العشوائي يضمن التفرّد
 * بلا استعلام فحص يسبق كل إنشاء (والسباق بينهما يفلت منه أصلاً).
 */
export function productSlug(nameEn: string | null | undefined, suffix: string): string {
  const base = (nameEn ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'product'}-${suffix}`;
}
