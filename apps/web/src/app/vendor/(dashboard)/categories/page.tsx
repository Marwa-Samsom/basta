'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, EmptyState, PageHead, Spinner } from '@/components/ui';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { num, type Page, type ProductListItem, type VendorCategory } from '@/lib/catalog';

/** «فئة واحدة · فئتان · 3 فئات · 11 فئة» */
function categoriesLabel(n: number): string {
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
  const ask = useConfirm();
  const [items, setItems] = useState<VendorCategory[] | null>(null);
  const [uncategorized, setUncategorized] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

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
        if (alive) setError(err instanceof Error ? err.message : 'تعذّر تحميل الفئات.');
      });
    return () => {
      alive = false;
    };
  }, [fetchAll]);

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
      setError(err instanceof Error ? err.message : 'تعذّرت العملية.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = async (): Promise<void> => {
    const name = draft.trim();
    if (!name) return;
    if (await run(() => api('/vendor/categories', { method: 'POST', body: { nameAr: name } }), `أُضيفت «${name}».`)) {
      setDraft('');
    }
  };

  const rename = async (): Promise<void> => {
    if (!editing?.name.trim()) return;
    const { id, name } = editing;
    if (await run(() => api(`/vendor/categories/${id}`, { method: 'PATCH', body: { nameAr: name.trim() } }), 'حُفظ الاسم.')) {
      setEditing(null);
    }
  };

  const move = (index: number, by: -1 | 1): void => {
    if (!items) return;
    const ids = items.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run(() => api('/vendor/categories/order', { method: 'PUT', body: { ids } }), 'حُفظ الترتيب.');
  };

  const remove = async (c: VendorCategory): Promise<void> => {
    if (c.productCount > 0) {
      setNotice(null);
      setError(`«${c.nameAr}» فيها ${num(c.productCount)} ${c.productCount === 1 ? 'منتج' : 'منتجات'} — انقلها إلى فئة أخرى من محرّر كل منتج قبل حذفها.`);
      return;
    }
    const sure = await ask({
      title: `تحذف فئة «${c.nameAr}»؟`,
      body: 'تختفي من صفحة متجرك ومن قائمة الفئات في محرّر المنتج. لا منتج فيها.',
      confirmLabel: 'احذف الفئة',
      danger: true,
    });
    if (!sure) return;
    void run(() => api(`/vendor/categories/${c.id}`, { method: 'DELETE' }), `حُذفت «${c.nameAr}».`);
  };

  if (!items) {
    return error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ تحميل الفئات…" />;
  }

  return (
    <div className="vp-page">
      <PageHead
        title="الفئات"
        count={items.length > 0 ? categoriesLabel(items.length) : undefined}
        actions={
          <Link className="btn btn--secondary" href="/vendor/products">
            <Icon name="package" size={16} />
            المنتجات
          </Link>
        }
      />
      <p className="vc-lead">
        رتّب منتجاتك في فئات يراها المشترون أزراراً في صفحة متجرك، بالترتيب الذي تضعه هنا. الفئات لك وحدك ولا
        تحتاج موافقة الإدارة، وتضيفها أيضاً من محرّر المنتج مباشرة.
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <section className="card" aria-label="فئة جديدة">
        <form
          className="vc-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="field__label" htmlFor="vc-new">
            فئة جديدة
          </label>
          <div className="vp-newcat">
            <input
              id="vc-new"
              className="field__control"
              maxLength={80}
              placeholder="مثل: قمصان صيفية"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !draft.trim()}>
              <Icon name="plus" size={16} />
              أضف الفئة
            </button>
          </div>
        </form>
      </section>

      {items.length === 0 ? (
        <EmptyState icon="list" title="لا فئات بعد">
          أضف أول فئة أعلاه — «قمصان» أو «عروض الأسبوع» مثلاً — ثم ضع منتجاتك فيها من محرّر كل منتج.
        </EmptyState>
      ) : (
        <section className="card card--flush" aria-label="فئات متجرك">
          <ul className="vc-list">
            {items.map((c, i) => (
              <li key={c.id} className="vc-row">
                <span className="vc-order">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm vc-up"
                    aria-label={`انقل «${c.nameAr}» للأعلى`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <Icon name="chev-down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={`انقل «${c.nameAr}» للأسفل`}
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
                    <input
                      className="field__control"
                      aria-label={`الاسم الجديد لـ«${c.nameAr}»`}
                      // يظهر الحقل بضغط البائع على «أعد التسمية» — فالتركيز فيه متوقَّع
                      autoFocus
                      maxLength={80}
                      value={editing.name}
                      onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !editing.name.trim()}>
                      احفظ
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
                      إلغاء
                    </button>
                  </form>
                ) : (
                  <span className="vc-name">
                    <span className="vc-name__text">{c.nameAr}</span>
                    <Link className="vc-count" href={`/vendor/products?category=${c.id}`}>
                      {c.productCount === 0 ? 'لا منتجات' : <><span className="num">{num(c.productCount)}</span> منتج</>}
                    </Link>
                  </span>
                )}

                {editing?.id === c.id ? null : (
                  <span className="vc-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={busy}
                      onClick={() => setEditing({ id: c.id, name: c.nameAr })}
                    >
                      أعد التسمية
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm"
                      aria-label={`احذف «${c.nameAr}»`}
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
                <span className="num">{num(uncategorized)}</span> منتج بلا فئة — صنّفها، فالفئة تُطلب عند تعديلها أو نشرها
              </Link>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
