'use client';

import { Icon } from '@/components/icons';
import { COUNTRIES, CURRENCIES } from '@/lib/vendor';

/**
 * أسئلة ST-29 الشائعة — أكورديون `<details>` أصلي: يعمل بلا سكربت وبلوحة
 * المفاتيح. مكوّن عميل فقط لأن قوائم البلدان والعملات في وحدة عميل
 * (`lib/vendor`) — القوائم نفسها التي يقرؤها التسجيل، فلا نسخة تنحرف عنها.
 */

const list = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;

export function SellFaq({ documents }: { documents: string }) {
  const faqs: { q: string; a: string }[] = [
    {
      q: 'كم عمولة بسطة؟',
      a: 'العمولة نسبة من قيمة القطع في كل عملية بيع — لا على الشحن — بلا اشتراك شهري ولا رسوم إدراج. تُثبَّت النسبة على الطلب لحظة الشراء، وتظهر نسبتها ومبلغها في تفصيل كل طلب وفي كشف حسابك، وإن أُرجعت قطع رُدّت عمولتها.',
    },
    {
      q: 'متى أستلم أرباحي؟',
      a: 'تبقى أرباح الطلب معلّقة فترة بعد تسليمه ثم تصير متاحة للسحب. تطلب السحب من صفحة المالية في لوحة التاجر، فتراجعه الإدارة ثم تحوّله إلى حسابك البنكي، وتتابع كل خطوة في كشف حسابك.',
    },
    {
      q: 'بأي عملة أُسعّر وأقبض؟',
      a: `تختار عملة تسوية واحدة بعد قبول متجرك: ${list(CURRENCIES.map((c) => c.nameAr))}. تُسعّر بها وتُحسب بها أرباحك، وتُثبَّت فلا تتغيّر بعد تثبيتها — لذلك تؤكّدها قبل التثبيت.`,
    },
    {
      q: 'ماذا أحتاج للتسجيل؟',
      a: `حساباً على بسطة، ثم ${documents}. كل مستند ملف PDF أو صورة JPEG أو PNG.`,
    },
    {
      q: 'من أي بلد يمكنني التسجيل؟',
      a: `التسجيل متاح للمتاجر في ${list(COUNTRIES.map((c) => c.nameAr))}.`,
    },
    {
      q: 'من يحدّد الشحن والإرجاع؟',
      a: 'أنت. تحدّد مناطق الشحن وأسعارها من إعدادات الشحن، وتكتب سياستي الشحن والإرجاع لمتجرك فتظهران في صفحة متجرك وصفحة كل منتج قبل الشراء.',
    },
  ];

  return (
    <div className="sx-faq__list">
      {faqs.map((f) => (
        <details key={f.q} className="sx-faq__item">
          <summary className="sx-faq__q">
            <span>{f.q}</span>
            <Icon name="chev-down" size={17} className="sx-faq__chev" />
          </summary>
          <p className="sx-faq__a">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
