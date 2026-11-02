import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { currentLocale } from './request-locale';
import { toEnglish } from './translate';

const ARABIC = /[؀-ۿ]/;

/**
 * ما كتبه بائع أو مدير أو مشترٍ بيده — اسم وصف عنوان نصّ قيمة سياسة — لا يُمسّ ولو طابق
 * جملة في القاموس مصادفة. وما سواه من أسماء النظام (labelAr للإعدادات وتفضيلات البريد،
 * toLabel لحالة الطلب، label لقيد الكشف، reason الذي يكتبه النظام في تاريخ الطلب) يُترجم
 * من القاموس كالرسائل — ما كتبه إنسان في label أو reason لا يطابق جملة فيه.
 */
const CONTENT_KEYS = new Set([
  'nameAr', 'nameEn', 'descriptionAr', 'titleAr', 'bodyAr', 'valueAr', 'valueTextAr', 'altAr',
  'shippingPolicyAr', 'returnPolicyAr', 'productNameAr', 'vendorNameAr', 'storeCategoryNameAr', 'brandNameAr',
  'body', 'subject', 'customerNote', 'rejectReason', 'transferNote',
  'fullName', 'recipientName', 'street', 'city', 'area', 'region', 'landmark', 'building', 'labelText',
]);

/**
 * رسائل الخادم داخل ردّ ناجح — موانع السلة والدفع («… نفد. احذفه من سلّتك.»)، وأسباب تعذّر
 * الشحن، وموانع النشر — بالإنجليزية حين يطلبها الموقع. يمرّ على الردّ كله ويترجم ما يعرفه
 * القاموس وحده؛ نصوص الناس (CONTENT_KEYS) تبقى كما كُتبت.
 */
@Injectable()
export class LocalizeResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body: unknown) => (currentLocale() === 'en' ? localizeDeep(body) : body)));
  }
}

export function localizeDeep(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return CONTENT_KEYS.has(key) || !ARABIC.test(value) ? value : toEnglish(value);
  if (Array.isArray(value)) return value.map((v) => localizeDeep(v, key));
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeDeep(v, k);
    return out;
  }
  return value;
}
