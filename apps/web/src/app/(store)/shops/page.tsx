import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { nameIn, translator, type Locale } from '@/lib/i18n';
import { pageLocale, serverT } from '@/lib/i18n-server';
import { getShops, num, type ShopCard } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('كل المتاجر', 'All shops') };
}

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/**
 * دليل المتاجر — حلّ محلّ «كل الأقسام» حين صارت الفئات لكل متجر (قرار صاحب المشروع
 * 14 أكتوبر 2026). المشتري يصل إلى ما يريد بالبحث أو بالمتجر، وداخل المتجر فئاته.
 * البحث نموذج GET حقيقي: يعمل بلا JavaScript.
 */
export default async function ShopsPage({ searchParams }: Props) {
  const query = await searchParams;
  // ?name= لا ?q=: صندوق البحث في الرأس يقرأ q فيملأ نفسه باسم المتجر
  const q = query['name']?.trim() ?? '';
  const page = Math.max(1, Number(query['page']) || 1);
  const [result, locale] = await Promise.all([getShops({ q, page }), pageLocale()]);
  const t = translator(locale);
  const pages = Math.ceil(result.total / result.pageSize);
  const pageHref = (n: number) => `/shops?${new URLSearchParams({ ...(q ? { name: q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;

  return (
    <div className="sd-cats sd-shopdir">
      <div className="page-head">
        <h1>{t('كل المتاجر', 'All shops')}</h1>
        {result.total > 0 ? (
          <span className="page-head__meta">
            {t(`${num(result.total)} متجر`, `${num(result.total, locale)} ${result.total === 1 ? 'shop' : 'shops'}`)}
          </span>
        ) : null}
      </div>

      <form className="sd-shopdir__search" action="/shops" role="search">
        <label className="visually-hidden" htmlFor="sd-shop-q">
          {t('ابحث عن متجر بالاسم', 'Search for a shop by name')}
        </label>
        <input
          id="sd-shop-q"
          className="field__control"
          type="search"
          name="name"
          defaultValue={q}
          placeholder={t('ابحث عن متجر بالاسم', 'Search for a shop by name')}
        />
        <button type="submit" className="btn btn--secondary">
          <Icon name="search" size={16} />
          {t('ابحث', 'Search')}
        </button>
      </form>

      {result.items.length > 0 ? (
        <div className="sd-shops sd-shops--dir">
          {result.items.map((s) => (
            <ShopCardLink key={s.id} shop={s} locale={locale} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="store"
          title={q ? t(`لا متجر باسم «${q}»`, `No shop named “${q}”`) : t('لا متاجر بعد', 'No shops yet')}
          actions={
            q ? (
              <Link className="btn btn--secondary" href="/shops">
                {t('كل المتاجر', 'All shops')}
              </Link>
            ) : (
              <Link className="btn btn--secondary" href="/vendor/register">
                {t('افتح متجرك', 'Open your shop')}
              </Link>
            )
          }
        >
          {q
            ? t(
                'جرّب جزءاً من الاسم، أو ابحث عن المنتج نفسه من صندوق البحث أعلى الصفحة.',
                'Try part of the name, or search for the product itself from the search box at the top of the page.',
              )
            : t('أول المتاجر تجهّز منتجاتها الآن.', 'The first shops are getting their products ready now.')}
        </EmptyState>
      )}

      {/* لا متجر بالجملة كاملة: ما في اسمه كلمة منها — «متجر الصوف» يدلّ على «بيت الصوف» (DISC-075) */}
      {result.items.length === 0 && result.suggestions?.length ? (
        <section className="sd-shopdir__near" aria-labelledby="sd-shop-near">
          <h2 id="sd-shop-near">{t('متاجر قريبة من بحثك', 'Shops close to your search')}</h2>
          <div className="sd-shops sd-shops--dir">
            {result.suggestions.map((s) => (
              <ShopCardLink key={s.id} shop={s} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {pages > 1 ? (
        <nav className="sd-pager" aria-label={t('صفحات المتاجر', 'Shop pages')}>
          {page > 1 ? (
            <Link className="btn btn--secondary btn--sm" href={pageHref(page - 1)}>
              {t('السابق', 'Previous')}
            </Link>
          ) : null}
          <span className="small muted">
            {t('صفحة', 'Page')} <span className="num">{num(page, locale)}</span> {t('من', 'of')}{' '}
            <span className="num">{num(pages, locale)}</span>
          </span>
          {page < pages ? (
            <Link className="btn btn--secondary btn--sm" href={pageHref(page + 1)}>
              {t('التالي', 'Next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function ShopCardLink({ shop: s, locale }: { shop: ShopCard; locale: Locale }) {
  const t = translator(locale);
  return (
    <Link href={`/s/${encodeURIComponent(s.slug)}`} className="sd-shopcard">
      <span className="sd-shopcard__logo" aria-hidden>
        <Icon name="store" size={22} />
      </span>
      <span className="sd-shopcard__body">
        <span className="sd-shopcard__name">{nameIn(locale, s)}</span>
        <span className="sd-shopcard__meta">
          <span className="num">{num(s.productCount, locale)}</span>{' '}
          {t('منتج', s.productCount === 1 ? 'product' : 'products')}
          {s.ratingCount > 0 ? (
            <>
              {' · '}
              <Icon name="star-fill" size={11} />{' '}
              <span className="num">{s.ratingAvg.toFixed(1)}</span>
            </>
          ) : null}
        </span>
        {s.categories.length > 0 ? (
          <span className="sd-shopcard__cats">{(locale === 'en' && s.categoriesEn ? s.categoriesEn : s.categories).join(' · ')}</span>
        ) : null}
      </span>
      <Icon name="chev-end" size={16} mirror className="sd-shopcard__chev" />
    </Link>
  );
}
