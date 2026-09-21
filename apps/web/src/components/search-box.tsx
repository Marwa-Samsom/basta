'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1';

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (value.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/storefront/suggest?q=${encodeURIComponent(value)}`);
        const data = (await res.json()) as { suggestions: string[] };
        setSuggestions(data.suggestions);
        setActive(-1);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => {
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
      <input
        id={`${listId}-input`}
        name="q"
        type="search"
        className="field__control search__input"
        placeholder="ابحث عن منتج أو متجر…"
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
      <button type="submit" className="btn btn--primary">
        بحث
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
