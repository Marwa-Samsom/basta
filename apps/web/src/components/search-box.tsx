'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { apiBase } from '@/lib/api';

/**
 * صندوق البحث — ST-06.
 *
 * **نموذج GET حقيقي** إلى /search: يعمل بلا JavaScript، والاقتراحات تحسين
 * فوقه لا بديل عنه. والاقتراح بتأخير 200 مللي ثانية: عند كل ضغطة يُغرق
 * الخادم، وبعد التوقّف يصل متأخّراً فلا يفيد.
 */
function SearchBoxInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** بعد 429 تتوقّف الاقتراحات قليلاً — لا تُثقل خادماً يقول «أبطئ» */
  const pausedUntil = useRef(0);

  /**
   * الاقتراحات تحسين لا شرط: أي ردّ غير قائمة نصوص (429، 500، جسم آخر) يُفرغها ولا
   * يمسّ الصندوق. كان جسم الخطأ يُقرأ كأنه اقتراحات فتصير undefined، ويسقط المكوّن
   * كله عند أول .length — ومعه البحث نفسه. والطلب السابق يُلغى: ردّ قديم بطيء لا
   * يكتب فوق ما كُتب بعده.
   */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const abort = new AbortController();
    timer.current = setTimeout(async () => {
      if (value.trim().length < 2 || Date.now() < pausedUntil.current) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(`${apiBase()}/storefront/suggest?q=${encodeURIComponent(value)}`, { signal: abort.signal });
        if (res.status === 429) pausedUntil.current = Date.now() + 10_000;
        const data = res.ok ? ((await res.json()) as { suggestions?: unknown }) : null;
        const list = Array.isArray(data?.suggestions) ? data.suggestions.filter((s): s is string => typeof s === 'string') : [];
        setSuggestions(list);
        setActive(-1);
      } catch {
        if (!abort.signal.aborted) setSuggestions([]);
      }
    }, 200);
    return () => {
      abort.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  function go(term: string): void {
    setOpen(false);
    if (term.trim()) router.push(`/search?q=${encodeURIComponent(term.trim())}`);
  }

  return (
    <form
      className="search"
      role="search"
      action="/search"
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        go(active >= 0 ? (suggestions[active] ?? value) : value);
      }}
    >
      <label htmlFor={`${listId}-input`} className="visually-hidden">
        ابحث في بسطة
      </label>
      <Icon name="search" size={18} className="search__icon" />
      <input
        ref={input}
        id={`${listId}-input`}
        name="q"
        type="search"
        className="search__input"
        placeholder="ابحث عن منتج أو متجر"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(active >= 0 ? { 'aria-activedescendant': `${listId}-${active}` } : {})}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {/* يمحو المكتوب كله ويُبقي المؤشّر في الخانة لكتابة غيره (26 أكتوبر 2026، بطلب صاحبة المشروع) */}
      {value ? (
        <button
          type="button"
          className="search__clear"
          aria-label="امسح ما كتبته"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setValue('');
            setSuggestions([]);
            setActive(-1);
            input.current?.focus();
          }}
        >
          <Icon name="x" size={16} />
        </button>
      ) : null}
      <button type="submit" className="search__go">
        ابحث
      </button>

      {open && suggestions.length > 0 ? (
        <ul className="search__list" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="search__option"
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
            >
              <span className="search__option-icon" aria-hidden>
                <Icon name="search" size={16} />
              </span>
              {s}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function SearchBox() {
  return (
    <Suspense fallback={<div className="search" />}>
      <SearchBoxInner />
    </Suspense>
  );
}
