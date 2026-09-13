/**
 * مصفوفة المتغيّرات — SRS V-02.
 *
 * المنتج بلا سعر، والسعر والمخزون على المتغيّر حصراً (ERD). منتج بلا خيارات
 * يحمل متغيّراً افتراضياً واحداً بتركيبة فارغة، فيمرّ كل كود تسعير بفرع واحد.
 */
import { DuplicateError, InvalidInputError } from '../../../common/errors/domain-error';

export const MAX_VARIANTS_PER_PRODUCT = 100;
export const MAX_OPTION_AXES = 3;

/** حروف لاتينية وأرقام وفواصل شائعة — SKU يُطبع على ملصقات ويُمسح بقارئ */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;

export interface OptionChoice {
  readonly attributeId: string;
  readonly valueId: string;
}

export interface VariantDraft {
  readonly sku: string;
  readonly options: readonly OptionChoice[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const normalizeSku = (sku: string): string => sku.trim();

export function assertSku(sku: string): void {
  if (!SKU_PATTERN.test(sku)) {
    throw new InvalidInputError(
      `SKU «${sku}» غير صالح: حروف لاتينية وأرقام و . _ - / فقط، يبدأ بحرف أو رقم، وحتى 64 محرفاً.`,
      { sku },
    );
  }
}

/**
 * مفتاح التركيبة: أزواج سمة:قيمة مرتّبة بمعرّف السمة.
 * الترتيب يجعل (أحمر، M) و (M، أحمر) مفتاحاً واحداً — وإلا مرّ التكرار.
 */
export function optionsKeyOf(options: readonly OptionChoice[]): string {
  const seen = new Set<string>();
  for (const o of options) {
    if (seen.has(o.attributeId)) {
      throw new InvalidInputError('السمة نفسها مذكورة مرتين في متغيّر واحد — لكل سمة قيمة واحدة.', {
        attributeId: o.attributeId,
      });
    }
    seen.add(o.attributeId);
  }
  return [...options]
    .sort((a, b) => byString(a.attributeId, b.attributeId))
    .map((o) => `${o.attributeId}:${o.valueId}`)
    .join('|');
}

export const axesKeyOf = (options: readonly OptionChoice[]): string =>
  options
    .map((o) => o.attributeId)
    .sort(byString)
    .join('|');

/**
 * يتحقق من المجموعة الحيّة كاملةً ويُرجع مفتاح تركيبة كل متغيّر بترتيبه.
 * يُستدعى على الناتج النهائي بعد التعديل، لا على الفرق وحده.
 */
export function assertVariantMatrix(variants: readonly VariantDraft[]): string[] {
  const first = variants[0];
  if (!first) {
    throw new InvalidInputError('المنتج يحتاج متغيّراً واحداً على الأقل يحمل السعر والمخزون.');
  }
  if (variants.length > MAX_VARIANTS_PER_PRODUCT) {
    throw new InvalidInputError(
      `الحد ${MAX_VARIANTS_PER_PRODUCT} متغيّر للمنتج الواحد، والمُرسل ${variants.length}.`,
    );
  }
  if (first.options.length > MAX_OPTION_AXES) {
    throw new InvalidInputError(`الحد ${MAX_OPTION_AXES} سمات تميّز المتغيّرات (مثل المقاس واللون).`);
  }
  if (variants.length > 1 && first.options.length === 0) {
    throw new InvalidInputError(
      'أكثر من متغيّر بلا خيارات تميّزها — أضف لكل متغيّر سمة مثل المقاس أو اللون.',
    );
  }

  const axes = axesKeyOf(first.options);
  const skus = new Map<string, number>();
  const combos = new Map<string, string>();
  const keys: string[] = [];

  variants.forEach((variant, i) => {
    const sku = normalizeSku(variant.sku);
    assertSku(sku);

    const earlier = skus.get(sku);
    if (earlier !== undefined) {
      throw new DuplicateError(`SKU «${sku}» مكرر بين المتغيّرين ${earlier + 1} و ${i + 1}.`, { sku });
    }
    skus.set(sku, i);

    if (axesKeyOf(variant.options) !== axes) {
      throw new InvalidInputError(
        `المتغيّر «${sku}» لا يحمل السمات نفسها التي تحملها بقية المتغيّرات — كلها تُعرَّف بالسمات ذاتها.`,
        { sku },
      );
    }

    const key = optionsKeyOf(variant.options);
    const clash = combos.get(key);
    if (clash !== undefined) {
      throw new DuplicateError(
        `التركيبة نفسها مكررة في المتغيّرين «${clash}» و«${sku}» — غيّر قيمة خيار في أحدهما.`,
        { skus: [clash, sku] },
      );
    }
    combos.set(key, sku);
    keys.push(key);
  });

  return keys;
}

/** السمات الإلزامية للفئة التي لم تُملأ — تمنع النشر لا الحفظ كمسودة (SRS V-02). */
export function missingRequiredAttributes(
  required: readonly { readonly attributeId: string; readonly nameAr: string }[],
  provided: ReadonlySet<string>,
): string[] {
  return required.filter((r) => !provided.has(r.attributeId)).map((r) => r.nameAr);
}
