'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, ClearableInput, EmptyState, PageHead, Spinner } from '@/components/ui';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { num, type Page, type ProductListItem, type VendorCategory } from '@/lib/catalog';
import { useLocale, useT } from '@/components/locale';
import type { Locale } from '@/lib/i18n';

/** «فئة واحدة · فئتان · 3 فئات · 11 فئة» */
function categoriesLabel(n: number, locale: Locale): string {
  if (locale === 'en') return `${num(n, locale)} ${n === 1 ? 'category' : 'categories'}`;
  if (n === 1) return 'فئة واحدة';
  if (n === 2) return 'فئتان';
  if (n <= 10) return `${num(n)} فئات`;
  return `${num(n)} فئة`;
}

/**
 * فئات المتجر — قرار صاحب المشروع 14 أكتوبر 2026: «كل متجر له فئاته، ينشئها
 * دون تدخّل الإدارة». قائمة مسطّحة بترتيب البائع، وهو ترتيب أزرارها في صفحة
 * متجره. والمتجر يبدأ بثماني فئات مقترحة يعدّلها (18 أكتوبر 2026)، والفئة التي
 * فيها منتجات لا تُحذف قبل نقلها — لا منتج بلا فئة.
 */
export default function VendorCategoriesPage() {
  const t = useT();
  const locale = useLocale();
  const ask = useConfirm();
  const [items, setItems] = useState<VendorCategory[] | null>(null);
  const [uncategorized, setUncategorized] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftEn, setDraftEn] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; nameEn: string } | null>(null);

  /** الفئات وعدد ما بلا فئة — معاً، فالرقمان من لحظة واحدة */
  const fetchAll = useCallback(
    () =>
      Promise.all([
        api<VendorCategory[]>('/vendor/categories'),
        api<Page<ProductListItem>>('/vendor/products?category=none&pageSize=1'),
      ]),
    [],
  );

  useEffect(() => {
    let alive = true;
    fetchAll()
      .then(([list, none]) => {
        if (!alive) return;
        setItems(list);
        setUncategorized(none.total);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : t('تعذّر تحميل الفئات.', 'Could not load categories.'));
      });
    return () => {
      alive = false;
    };
  }, [fetchAll, t]);

  /** بعد كل كتابة: القائمة كما يراها الخادم الآن */
  async function load(): Promise<void> {
    const [list, none] = await fetchAll();
    setItems(list);
    setUncategorized(none.total);
  }

  /** كل كتابة تمرّ هنا: رسالة النجاح أو الخطأ، ثم القائمة من الخادم */
  async function run(fn: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّرت العملية.', 'The operation failed.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = async (): Promise<void> => {
    const name = draft.trim();
    if (!name) return;
    const nameEn = draftEn.trim();
    if (
      await run(
        () => api('/vendor/categories', { method: 'POST', body: { nameAr: name, ...(nameEn ? { nameEn } : {}) } }),
        t(`أُضيفت «${name}».`, `Added “${nameEn || name}”.`),
      )
    ) {
      setDraft('');
      setDraftEn('');
    }
  };

  const rename = async (): Promise<void> => {
    if (!editing?.name.trim()) return;
    const { id, name, nameEn } = editing;
    // الإنجليزي الفارغ يمحو ما كان — لا يبقى اسم قديم لا يراه البائع في الحقل
    if (await run(() => api(`/vendor/categories/${id}`, { method: 'PATCH', body: { nameAr: name.trim(), nameEn: nameEn.trim() } }), t('حُفظ الاسم.', 'Name saved.'))) {
      setEditing(null);
    }
  };

  const move = (index: number, by: -1 | 1): void => {
    if (!items) return;
    const ids = items.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run(() => api('/vendor/categories/order', { method: 'PUT', body: { ids } }), t('حُفظ الترتيب.', 'Order saved.'));
  };

  const remove = async (c: VendorCategory): Promise<void> => {
    if (c.productCount > 0) {
      setNotice(null);
      setError(
        t(
          `«${c.nameAr}» فيها ${num(c.productCount)} ${c.productCount === 1 ? 'منتج' : 'منتجات'} — انقلها إلى فئة أخرى من محرّر كل منتج قبل حذفها.`,
          `“${c.nameAr}” has ${num(c.productCount, locale)} ${c.productCount === 1 ? 'product' : 'products'} — move ${c.productCount === 1 ? 'it' : 'them'} to another category from each product’s editor before deleting it.`,
        ),
      );
      return;
    }
    const sure = await ask({
      title: t(`تحذف فئة «${c.nameAr}»؟`, `Delete the “${c.nameAr}” category?`),
      body: t(
        'تختفي من صفحة متجرك ومن قائمة الفئات في محرّر المنتج. لا منتج فيها.',
        'It disappears from your shop page and from the category list in the product editor. It has no products.',
      ),
      confirmLabel: t('احذف الفئة', 'Delete category'),
      danger: true,
    });
    if (!sure) return;
    void run(() => api(`/vendor/categories/${c.id}`, { method: 'DELETE' }), t(`حُذفت «${c.nameAr}».`, `Deleted “${c.nameAr}”.`));
  };

  if (!items) {
    return error ? <Alert tone="danger">{error}</Alert> : <Spinner label={t('جارٍ تحميل الفئات…', 'Loading categories…')} />;
  }

  return (
    <div className="vp-page">
      <PageHead
        title={t('الفئات', 'Categories')}
        count={items.length > 0 ? categoriesLabel(items.length, locale) : undefined}
        actions={
          <Link className="btn btn--secondary" href="/vendor/products">
            <Icon name="package" size={16} />
            {t('المنتجات', 'Products')}
          </Link>
        }
      />
      <p className="vc-lead">
        {t(
          'رتّب منتجاتك في فئات يراها المشترون أزراراً في صفحة متجرك، بالترتيب الذي تضعه هنا. الفئات لك وحدك ولا تحتاج موافقة الإدارة، وتضيفها أيضاً من محرّر المنتج مباشرة.',
          'Organize your products into categories that buyers see as buttons on your shop page, in the order you set here. Categories are yours alone and need no admin approval; you can also add them straight from the product editor.',
        )}
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <section className="card" aria-label={t('فئة جديدة', 'New category')}>
        <form
          className="vc-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="field__label" htmlFor="vc-new">
            {t('فئة جديدة', 'New category')}
          </label>
          <div className="vp-newcat">
            <ClearableInput
              id="vc-new"
              className="field__control"
              maxLength={80}
              placeholder={t('مثل: قمصان صيفية', 'e.g. Summer shirts')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <ClearableInput
              className="field__control"
              dir="ltr"
              maxLength={80}
              aria-label={t('اسم الفئة بالإنجليزية — اختياري', 'Category name in English — optional')}
              placeholder={t('بالإنجليزية (اختياري)', 'In English (optional)')}
              value={draftEn}
              onChange={(e) => setDraftEn(e.target.value)}
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !draft.trim()}>
              <Icon name="plus" size={16} />
              {t('أضف الفئة', 'Add category')}
            </button>
          </div>
        </form>
      </section>

      {items.length === 0 ? (
        <EmptyState icon="list" title={t('لا فئات بعد', 'No categories yet')}>
          {t(
            'أضف أول فئة أعلاه — «قمصان» أو «عروض الأسبوع» مثلاً — ثم ضع منتجاتك فيها من محرّر كل منتج.',
            'Add your first category above — “Shirts” or “Deals of the week”, for example — then put your products in it from each product’s editor.',
          )}
        </EmptyState>
      ) : (
        <section className="card card--flush" aria-label={t('فئات متجرك', 'Your shop categories')}>
          <ul className="vc-list">
            {items.map((c, i) => (
              <li key={c.id} className="vc-row">
                <span className="vc-order">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm vc-up"
                    aria-label={t(`انقل «${c.nameAr}» للأعلى`, `Move “${c.nameAr}” up`)}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <Icon name="chev-down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={t(`انقل «${c.nameAr}» للأسفل`, `Move “${c.nameAr}” down`)}
                    disabled={busy || i === items.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="chev-down" size={14} />
                  </button>
                </span>

                {editing?.id === c.id ? (
                  <form
                    className="vp-newcat vc-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <ClearableInput
                      className="field__control"
                      aria-label={t(`الاسم الجديد لـ«${c.nameAr}»`, `New name for “${c.nameAr}”`)}
                      // يظهر الحقل بضغط البائع على «أعد التسمية» — فالتركيز فيه متوقَّع
                      autoFocus
                      maxLength={80}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <ClearableInput
                      className="field__control"
                      dir="ltr"
                      aria-label={t(`الاسم الإنجليزي لـ«${c.nameAr}»`, `English name for “${c.nameAr}”`)}
                      placeholder={t('بالإنجليزية (اختياري)', 'In English (optional)')}
                      maxLength={80}
                      value={editing.nameEn}
                      onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !editing.name.trim()}>
                      {t('احفظ', 'Save')}
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
                      {t('إلغاء', 'Cancel')}
                    </button>
                  </form>
                ) : (
                  <span className="vc-name">
                    <span className="vc-name__text">{c.nameAr}</span>
                    {c.nameEn ? (
                      <bdi className="vc-name__en" dir="ltr">
                        {c.nameEn}
                      </bdi>
                    ) : null}
                    <Link className="vc-count" href={`/vendor/products?category=${c.id}`}>
                      {c.productCount === 0 ? (
                        t('لا منتجات', 'No products')
                      ) : (
                        <>
                          <span className="num">{num(c.productCount, locale)}</span>{' '}
                          {t('منتج', c.productCount === 1 ? 'product' : 'products')}
                        </>
                      )}
                    </Link>
                  </span>
                )}

                {editing?.id === c.id ? null : (
                  <span className="vc-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={busy}
                      onClick={() => setEditing({ id: c.id, name: c.nameAr, nameEn: c.nameEn ?? '' })}
                    >
                      {t('أعد التسمية', 'Rename')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm"
                      aria-label={t(`احذف «${c.nameAr}»`, `Delete “${c.nameAr}”`)}
                      disabled={busy}
                      onClick={() => void remove(c)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {uncategorized ? (
            <div className="card__foot vp-foot">
              <Link className="small" href="/vendor/products?category=none">
                <span className="num">{num(uncategorized, locale)}</span>{' '}
                {t(
                  'منتج بلا فئة — صنّفها، فالفئة تُطلب عند تعديلها أو نشرها',
                  `${uncategorized === 1 ? 'product' : 'products'} without a category — categorize ${uncategorized === 1 ? 'it' : 'them'}; a category is required when you edit or publish`,
                )}
              </Link>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
