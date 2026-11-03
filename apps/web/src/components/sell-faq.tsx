'use client';

import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { COUNTRIES, CURRENCIES } from '@/lib/vendor';

/**
 * أسئلة ST-29 الشائعة — أكورديون `<details>` أصلي: يعمل بلا سكربت وبلوحة
 * المفاتيح. مكوّن عميل فقط لأن قوائم البلدان والعملات في وحدة عميل
 * (`lib/vendor`) — القوائم نفسها التي يقرؤها التسجيل، فلا نسخة تنحرف عنها.
 */

const list = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;

const listEn = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function SellFaq({ documents }: { documents: string }) {
  const t = useT();
  const faqs: { q: string; a: string }[] = [
    {
      q: t('كم عمولة بسطة؟', "What is Basta's commission?"),
      a: t(
        'العمولة نسبة من قيمة القطع في كل عملية بيع — لا على الشحن — بلا اشتراك شهري ولا رسوم إدراج. تُثبَّت النسبة على الطلب لحظة الشراء، وتظهر نسبتها ومبلغها في تفصيل كل طلب وفي كشف حسابك، وإن أُرجعت قطع رُدّت عمولتها.',
        'The commission is a percentage of the item value in each sale — not of shipping — with no monthly subscription and no listing fees. The rate is locked on the order at the moment of purchase, its rate and amount appear in each order’s breakdown and in your statement, and if items are returned their commission is refunded.',
      ),
    },
    {
      q: t('متى أستلم أرباحي؟', 'When do I get my earnings?'),
      a: t(
        'تبقى أرباح الطلب معلّقة فترة بعد تسليمه ثم تصير متاحة للسحب. تطلب السحب من صفحة المالية في لوحة التاجر، فتراجعه الإدارة ثم تحوّله إلى حسابك البنكي، وتتابع كل خطوة في كشف حسابك.',
        'An order’s earnings stay pending for a period after delivery, then become available to withdraw. You request a payout from the finance page in the seller dashboard; the admin reviews it and transfers it to your bank account, and you can follow every step in your statement.',
      ),
    },
    {
      q: t('بأي عملة أُسعّر وأقبض؟', 'Which currency do I price and get paid in?'),
      a: t(
        // كخطوة العملة في التسجيل: تُختار قبل الإرسال وتتغيّر حتى الإرسال، والاعتماد يثبّتها (ADR-013)
        `تختار عملة تسوية واحدة أثناء التسجيل، قبل إرسال طلبك للمراجعة: ${list(CURRENCIES.map((c) => c.nameAr))}. تُسعّر بها منتجاتك وتُحسب بها أرباحك. تستطيع تغييرها حتى ترسل طلبك، ثم يثبّتها اعتماد متجرك فلا تتغيّر بعده.`,
        `You choose one settlement currency during sign-up, before you submit your application for review: ${listEn(CURRENCIES.map((c) => c.nameEn))}. Your products are priced in it and your earnings are calculated in it, and you can change it until you submit your application — approval of your shop locks it, and it can’t change after that.`,
      ),
    },
    {
      q: t('ماذا أحتاج للتسجيل؟', 'What do I need to sign up?'),
      a: t(
        `حساباً على بسطة، ثم ${documents}. كل مستند ملف PDF أو صورة JPEG أو PNG.`,
        `A Basta account, then ${documents}. Each document is a PDF file or a JPEG or PNG image.`,
      ),
    },
    {
      q: t('من أي بلد يمكنني التسجيل؟', 'Which countries can I sign up from?'),
      a: t(
        `التسجيل متاح للمتاجر في ${list(COUNTRIES.map((c) => c.nameAr))}.`,
        `Sign-up is open to shops in ${listEn(COUNTRIES.map((c) => c.nameEn))}.`,
      ),
    },
    {
      q: t('من يحدّد الشحن والإرجاع؟', 'Who sets shipping and returns?'),
      a: t(
        'أنت. تحدّد مناطق الشحن وأسعارها من إعدادات الشحن، وتكتب سياستي الشحن والإرجاع لمتجرك فتظهران في صفحة متجرك وصفحة كل منتج قبل الشراء.',
        'You do. You set shipping zones and their rates in shipping settings, and you write your shop’s shipping and return policies, which appear on your shop page and on every product page before purchase.',
      ),
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
