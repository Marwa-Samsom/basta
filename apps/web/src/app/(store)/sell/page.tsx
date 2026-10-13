import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/screens/storefront-extra.css';
import { Icon, type IconName } from '@/components/icons';
import { SellFaq } from '@/components/sell-faq';

export const metadata: Metadata = {
  title: 'بِع على بسطة',
  description: 'افتح متجرك على بسطة: عمولة على كل عملية بيع بلا اشتراك، وتسعير وتسوية بعملتك.',
};

/**
 * ST-29 — بِع على بسطة.
 *
 * كل جملة هنا تصف ما يفعله النظام فعلاً. نسبة العمولة ومدّة تعليق الأرباح
 * لا تُكتب أرقاماً: لا مسار عامّ يعطيهما، وهما إعدادان تغيّرهما الإدارة —
 * رقم مكتوب هنا يشيخ بصمت. البائع يرى النسبة الحقيقية في تفصيل كل طلب.
 * البلدان والعملات من القوائم نفسها التي يقرؤها التسجيل، والمستندات
 * أنواع `DOCUMENT_TYPES` الأربعة في وحدة البائعين.
 */

const DOCUMENTS = 'السجل التجاري، والهوية الشخصية، والشهادة الضريبية، وإثبات الحساب البنكي';

const VALUES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'boxes',
    title: 'عمولة على البيع فقط',
    body: 'لا اشتراك شهري ولا رسوم إدراج. العمولة نسبة من قيمة القطع لا من الشحن، وتظهر نسبتها ومبلغها في تفصيل كل طلب.',
  },
  {
    icon: 'globe',
    title: 'سعّر واقبض بعملتك',
    body: 'تختار عملة تسوية واحدة لمتجرك، تُسعّر بها منتجاتك وتُحسب بها أرباحك وتُحوَّل.',
  },
  {
    icon: 'clock',
    title: 'أرباح تُحرَّر بعد التسليم',
    body: 'تبقى أرباح كل طلب معلّقة فترة بعد تسليمه، ثم تصير متاحة فتطلب تحويلها إلى حسابك البنكي.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'سجّل متجرك', body: 'اسم المتجر بالعربية والإنجليزية ورابطه، وبلدك ونوع نشاطك: فرد أو شركة، ثم عملة التسوية التي تسعّر وتقبض بها.' },
  { title: 'ارفع المستندات', body: `${DOCUMENTS} — ملف PDF أو صورة لكلٍّ منها.` },
  { title: 'نراجع طلبك', body: 'يراجع فريق بسطة المتجر ومستنداته قبل تفعيله، وترى حالة المراجعة من حسابك.' },
  {
    title: 'ابدأ البيع',
    body: 'بعد الموافقة تُثبَّت عملتك التي اخترتها، فتجهّز ملف متجرك والشحن، ثم تضيف منتجاتك وتستقبل طلباتك من لوحة التاجر.',
  },
];

export default function SellPage() {
  return (
    <div className="sx-sell">
      <section className="sx-sell__hero" aria-labelledby="sx-sell-title">
        <span className="sx-sell__kicker">بِع على بسطة</span>
        <h1 id="sx-sell-title" className="sx-sell__title">
          بِع لمشترين في الأردن والخليج ومصر
        </h1>
        <p className="sx-sell__lead">
          سعّر بعملتك، واقبض بعملتك. عمولة على كل عملية بيع فقط — بلا اشتراك شهري ولا رسوم إدراج.
        </p>
        <div className="sx-sell__ctas">
          <Link href="/vendor/register" className="btn btn--on-brand btn--lg">
            سجّل متجرك
            <Icon name="next" size={18} mirror />
          </Link>
          <a href="#faq" className="btn btn--lg sx-sell__ghost">
            الأسئلة الشائعة
          </a>
        </div>
      </section>

      <div className="sx-sell__body">
        <ul className="sx-sell__values">
          {VALUES.map((v) => (
            <li key={v.title} className="sx-sell__value">
              <span className="sx-sell__value-icon" aria-hidden>
                <Icon name={v.icon} size={21} />
              </span>
              <h2 className="sx-sell__value-title">{v.title}</h2>
              <p>{v.body}</p>
            </li>
          ))}
        </ul>

        <section className="sx-sell__block" aria-labelledby="sx-steps-title">
          <h2 id="sx-steps-title" className="sx-sell__h2">
            أربع خطوات وتبدأ
          </h2>
          <ol className="sx-sell__steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="sx-sell__step">
                <span className="sx-sell__step-n num" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="sx-sell__step-title">{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="faq" className="sx-sell__block sx-faq" aria-labelledby="sx-faq-title">
          <h2 id="sx-faq-title" className="sx-sell__h2">
            الأسئلة الشائعة
          </h2>
          <SellFaq documents={DOCUMENTS} />
        </section>

        <section className="sx-sell__cta" aria-labelledby="sx-cta-title">
          <span className="sx-sell__cta-text">
            <h2 id="sx-cta-title" className="sx-sell__cta-title">
              جاهز تبيع؟
            </h2>
            <span className="sx-sell__cta-note">تحتاج {DOCUMENTS}.</span>
          </span>
          <Link href="/vendor/register" className="btn btn--primary btn--lg sx-sell__cta-btn">
            سجّل متجرك
            <Icon name="next" size={18} mirror />
          </Link>
        </section>
      </div>
    </div>
  );
}
