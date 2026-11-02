import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/screens/storefront-extra.css';
import { Icon, type IconName } from '@/components/icons';
import { SellFaq } from '@/components/sell-faq';
import { pick, translator, type Bilingual } from '@/lib/i18n';
import { pageLocale, serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return {
    title: t('بِع على بسطة', 'Sell on Basta'),
    description: t(
      'افتح متجرك على بسطة: عمولة على كل عملية بيع بلا اشتراك، وتسعير وتسوية بعملتك.',
      'Open your shop on Basta: a commission on each sale with no subscription, and pricing and settlement in your currency.',
    ),
  };
}

/**
 * ST-29 — بِع على بسطة.
 *
 * كل جملة هنا تصف ما يفعله النظام فعلاً. نسبة العمولة ومدّة تعليق الأرباح
 * لا تُكتب أرقاماً: لا مسار عامّ يعطيهما، وهما إعدادان تغيّرهما الإدارة —
 * رقم مكتوب هنا يشيخ بصمت. البائع يرى النسبة الحقيقية في تفصيل كل طلب.
 * البلدان والعملات من القوائم نفسها التي يقرؤها التسجيل، والمستندات
 * أنواع `DOCUMENT_TYPES` الأربعة في وحدة البائعين.
 */

const DOCUMENTS: Bilingual = {
  ar: 'السجل التجاري، والهوية الشخصية، والشهادة الضريبية، وإثبات الحساب البنكي',
  en: 'your commercial register, personal ID, tax certificate and proof of bank account',
};

const VALUES: { icon: IconName; title: Bilingual; body: Bilingual }[] = [
  {
    icon: 'boxes',
    title: { ar: 'عمولة على البيع فقط', en: 'Commission on sales only' },
    body: {
      ar: 'لا اشتراك شهري ولا رسوم إدراج. العمولة نسبة من قيمة القطع لا من الشحن، وتظهر نسبتها ومبلغها في تفصيل كل طلب.',
      en: 'No monthly subscription and no listing fees. The commission is a percentage of the item value, not of shipping, and its rate and amount appear in the breakdown of every order.',
    },
  },
  {
    icon: 'globe',
    title: { ar: 'سعّر واقبض بعملتك', en: 'Price and get paid in your currency' },
    body: {
      ar: 'تختار عملة تسوية واحدة لمتجرك، تُسعّر بها منتجاتك وتُحسب بها أرباحك وتُحوَّل.',
      en: 'You choose one settlement currency for your shop: your products are priced in it, and your earnings are calculated and paid out in it.',
    },
  },
  {
    icon: 'clock',
    title: { ar: 'أرباح تُحرَّر بعد التسليم', en: 'Earnings released after delivery' },
    body: {
      ar: 'تبقى أرباح كل طلب معلّقة فترة بعد تسليمه، ثم تصير متاحة فتطلب تحويلها إلى حسابك البنكي.',
      en: 'The earnings from each order stay pending for a while after delivery, then become available and you can request a payout to your bank account.',
    },
  },
];

const STEPS: { title: Bilingual; body: Bilingual }[] = [
  {
    title: { ar: 'سجّل متجرك', en: 'Register your shop' },
    body: {
      ar: 'اسم المتجر بالعربية والإنجليزية ورابطه، وبلدك ونوع نشاطك: فرد أو شركة، ثم عملة التسوية التي تسعّر وتقبض بها.',
      en: 'Your shop name in Arabic and English and its link, your country and business type (individual or company), then the settlement currency you price and get paid in.',
    },
  },
  {
    title: { ar: 'ارفع المستندات', en: 'Upload the documents' },
    body: {
      ar: `${DOCUMENTS.ar} — ملف PDF أو صورة لكلٍّ منها.`,
      en: 'Your commercial register, personal ID, tax certificate and proof of bank account — a PDF or an image of each.',
    },
  },
  {
    title: { ar: 'نراجع طلبك', en: 'We review your application' },
    body: {
      ar: 'يراجع فريق بسطة المتجر ومستنداته قبل تفعيله، وترى حالة المراجعة من حسابك.',
      en: 'The Basta team reviews the shop and its documents before activating it, and you can see the review status from your account.',
    },
  },
  {
    title: { ar: 'ابدأ البيع', en: 'Start selling' },
    body: {
      ar: 'بعد الموافقة تُثبَّت عملتك التي اخترتها، فتجهّز ملف متجرك والشحن، ثم تضيف منتجاتك وتستقبل طلباتك من لوحة التاجر.',
      en: 'Once approved, the currency you chose is locked in. You set up your shop profile and shipping, then add your products and receive orders from the seller dashboard.',
    },
  },
];

export default async function SellPage() {
  const locale = await pageLocale();
  const t = translator(locale);
  return (
    <div className="sx-sell">
      <section className="sx-sell__hero" aria-labelledby="sx-sell-title">
        <span className="sx-sell__kicker">{t('بِع على بسطة', 'Sell on Basta')}</span>
        <h1 id="sx-sell-title" className="sx-sell__title">
          {t('بِع لمشترين في الأردن والخليج ومصر', 'Sell to buyers in Jordan, the Gulf and Egypt')}
        </h1>
        <p className="sx-sell__lead">
          {t(
            'سعّر بعملتك، واقبض بعملتك. عمولة على كل عملية بيع فقط — بلا اشتراك شهري ولا رسوم إدراج.',
            'Price in your currency, get paid in your currency. A commission on each sale only — no monthly subscription and no listing fees.',
          )}
        </p>
        <div className="sx-sell__ctas">
          <Link href="/vendor/register" className="btn btn--on-brand btn--lg">
            {t('سجّل متجرك', 'Register your shop')}
            <Icon name="next" size={18} mirror />
          </Link>
          <a href="#faq" className="btn btn--lg sx-sell__ghost">
            {t('الأسئلة الشائعة', 'FAQ')}
          </a>
        </div>
      </section>

      <div className="sx-sell__body">
        <ul className="sx-sell__values">
          {VALUES.map((v) => (
            <li key={v.title.ar} className="sx-sell__value">
              <span className="sx-sell__value-icon" aria-hidden>
                <Icon name={v.icon} size={21} />
              </span>
              <h2 className="sx-sell__value-title">{pick(locale, v.title)}</h2>
              <p>{pick(locale, v.body)}</p>
            </li>
          ))}
        </ul>

        <section className="sx-sell__block" aria-labelledby="sx-steps-title">
          <h2 id="sx-steps-title" className="sx-sell__h2">
            {t('أربع خطوات وتبدأ', 'Four steps to start selling')}
          </h2>
          <ol className="sx-sell__steps">
            {STEPS.map((s, i) => (
              <li key={s.title.ar} className="sx-sell__step">
                <span className="sx-sell__step-n num" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="sx-sell__step-title">{pick(locale, s.title)}</h3>
                <p>{pick(locale, s.body)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="faq" className="sx-sell__block sx-faq" aria-labelledby="sx-faq-title">
          <h2 id="sx-faq-title" className="sx-sell__h2">
            {t('الأسئلة الشائعة', 'FAQ')}
          </h2>
          <SellFaq documents={pick(locale, DOCUMENTS)} />
        </section>

        <section className="sx-sell__cta" aria-labelledby="sx-cta-title">
          <span className="sx-sell__cta-text">
            <h2 id="sx-cta-title" className="sx-sell__cta-title">
              {t('جاهز تبيع؟', 'Ready to sell?')}
            </h2>
            <span className="sx-sell__cta-note">{t(`تحتاج ${DOCUMENTS.ar}.`, `You need ${DOCUMENTS.en}.`)}</span>
          </span>
          <Link href="/vendor/register" className="btn btn--primary btn--lg sx-sell__cta-btn">
            {t('سجّل متجرك', 'Register your shop')}
            <Icon name="next" size={18} mirror />
          </Link>
        </section>
      </div>
    </div>
  );
}
