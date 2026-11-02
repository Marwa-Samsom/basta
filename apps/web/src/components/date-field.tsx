'use client';

import '@/styles/screens/date-field.css';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { intlLocale } from '@/lib/i18n';

/** يوم تقويمي بلا منطقة زمنية — كل الحساب على UTC كي لا ينزلق يوم عند منتصف الليل */
interface Day {
  y: number;
  m: number; // 0–11
  d: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = ({ y, m, d }: Day) => `${y}-${pad(m + 1)}-${pad(d)}`;
const utc = ({ y, m, d }: Day) => new Date(Date.UTC(y, m, d));
const dayOf = (date: Date): Day => ({ y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() });
const shift = (day: Day, days: number): Day => dayOf(new Date(utc(day).getTime() + days * 86_400_000));
const parseDay = (iso: string | undefined): Day | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
};
const today = (): Day => {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
};

/**
 * خانة تاريخ بلغة الموقع — بدل `<input type="date">` الذي يرسمه المتصفّح بلغته هو: كانت
 * «mm/dd/yyyy» والشهر قبل اليوم على صفحة عربية (2 نوفمبر 2026). تعرض التاريخ بلغة زرّ
 * اللغة، وتفتح تقويماً بأسماء الأشهر والأيام بها، والأرقام لاتينية في اللغتين.
 *
 * القيمة بصيغة الخانة الأصلية نفسها — `YYYY-MM-DD`، و`YYYY-MM-DDTHH:mm` مع `withTime` —
 * فتأخذ مكانها في الصفحة بلا تغيير فيما حولها.
 */
export function DateField({
  value,
  onChange,
  withTime = false,
  min,
  max,
  clearable = false,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  min?: string | undefined;
  max?: string | undefined;
  /** زرّ «امسح» — لتاريخ اختياري (نهاية حملة مثلاً) */
  clearable?: boolean;
  /**
   * اسم الخانة لقارئ الشاشة. لا تُلفّ بـ `<label>`: النقر على فراغ في التقويم يُحوَّل عندها
   * إلى زرّ الخانة فيُغلق التقويم تحت المؤشّر
   */
  label: string;
}) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const selected = parseDay(value);
  const time = withTime ? (/T(\d{2}):(\d{2})/.exec(value)?.slice(1, 3) ?? ['00', '00']) : null;
  const [open, setOpen] = useState(false);
  /** اليوم الذي عليه التركيز في التقويم — ومنه الشهر المعروض */
  const [focus, setFocus] = useState<Day>(() => selected ?? today());
  const lo = parseDay(min);
  const hi = parseDay(max);
  const outside = (day: Day) => (lo !== null && isoOf(day) < isoOf(lo)) || (hi !== null && isoOf(day) > isoOf(hi));

  const fmt = useMemo(() => {
    const loc = intlLocale(locale);
    return {
      full: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
      month: new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      weekday: new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' }),
    };
  }, [locale]);

  // السبت أول الأسبوع بالعربية كما في الأردن والخليج، والأحد بالإنجليزية
  const weekStart = locale === 'ar' ? 6 : 0;
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt.weekday.format(new Date(Date.UTC(2026, 0, 3 + ((weekStart - 6 + i + 7) % 7)))));
  const first: Day = { y: focus.y, m: focus.m, d: 1 };
  const lead = (utc(first).getUTCDay() - weekStart + 7) % 7;
  const length = new Date(Date.UTC(focus.y, focus.m + 1, 0)).getUTCDate();
  const cells: (Day | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => ({ y: focus.y, m: focus.m, d: i + 1 }))];

  const emit = (day: Day | null, hm: readonly string[] | null = time) => {
    if (!day) return onChange('');
    onChange(withTime ? `${isoOf(day)}T${hm?.[0] ?? '00'}:${hm?.[1] ?? '00'}` : isoOf(day));
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // تُغلق بنقرة خارجها
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // التركيز يتبع اليوم المختار بالأسهم
  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${isoOf(focus)}"]`)?.focus();
  }, [open, focus]);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // الأسهم بصرية: في العربية اليمين للأمس
    const ahead = document.documentElement.dir === 'rtl' ? -1 : 1;
    const moves: Record<string, number> = { ArrowRight: ahead, ArrowLeft: -ahead, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in moves) {
      e.preventDefault();
      setFocus((f) => shift(f, moves[e.key]!));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setFocus((f) => {
        const next = new Date(Date.UTC(f.y, f.m + (e.key === 'PageDown' ? 1 : -1), 1));
        return { y: next.getUTCFullYear(), m: next.getUTCMonth(), d: Math.min(f.d, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()) };
      });
    }
  };

  const month = (delta: number) =>
    setFocus((f) => {
      const next = new Date(Date.UTC(f.y, f.m + delta, 1));
      return { y: next.getUTCFullYear(), m: next.getUTCMonth(), d: 1 };
    });

  const shown = selected ? `${fmt.full.format(utc(selected))}${time ? ` · ${time[0]}:${time[1]}` : ''}` : '';

  return (
    <div
      className="date-field"
      ref={root}
      onKeyDown={(e) => {
        // Esc يغلق التقويم وحده لا النافذة التي تحويه
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close(true);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="field__control date-field__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${shown || t('لم يُختر', 'not set')}`}
        onClick={() => {
          setFocus(selected ?? today());
          setOpen((v) => !v);
        }}
      >
        <Icon name="calendar" size={16} />
        <span className="date-field__value" data-empty={!shown || undefined}>
          {shown || t('اختر تاريخاً', 'Pick a date')}
        </span>
      </button>

      {open ? (
        <div className="date-pop" role="dialog" aria-label={t('اختر تاريخاً', 'Pick a date')}>
          <div className="date-pop__head">
            <button type="button" className="icon-btn icon-btn--sm date-pop__prev" aria-label={t('الشهر السابق', 'Previous month')} onClick={() => month(-1)}>
              <Icon name="chev-end" size={16} mirror />
            </button>
            <strong className="date-pop__month" aria-live="polite" id={`${id}-month`}>
              {fmt.month.format(utc(first))}
            </strong>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t('الشهر التالي', 'Next month')} onClick={() => month(1)}>
              <Icon name="chev-end" size={16} mirror />
            </button>
          </div>
          <div className="date-pop__grid" ref={grid} role="group" aria-labelledby={`${id}-month`} onKeyDown={onGridKey}>
            {weekdays.map((w) => (
              <span key={w} className="date-pop__weekday" aria-hidden>
                {w}
              </span>
            ))}
            {cells.map((day, i) =>
              day ? (
                <button
                  key={isoOf(day)}
                  type="button"
                  className="date-pop__day"
                  data-day={isoOf(day)}
                  tabIndex={isoOf(day) === isoOf(focus) ? 0 : -1}
                  aria-label={fmt.full.format(utc(day))}
                  aria-pressed={selected !== null && isoOf(day) === isoOf(selected)}
                  {...(isoOf(day) === isoOf(today()) ? { 'aria-current': 'date' as const } : {})}
                  disabled={outside(day)}
                  onClick={() => {
                    emit(day);
                    if (!withTime) close(true);
                  }}
                >
                  {day.d}
                </button>
              ) : (
                <span key={`lead-${i}`} aria-hidden />
              ),
            )}
          </div>
          {time ? (
            <div className="date-pop__time">
              <span>{t('الساعة', 'Time')}</span>
              {/* الساعة قبل الدقيقة في اللغتين: الوقت يُقرأ يساراً إلى يمين أرقاماً */}
              <span className="date-pop__hm" dir="ltr">
                <select aria-label={t('الساعة', 'Hour')} value={time[0]} onChange={(e) => emit(selected ?? today(), [e.target.value, time[1] ?? '00'])}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={pad(h)}>
                      {pad(h)}
                    </option>
                  ))}
                </select>
                :
                <select aria-label={t('الدقيقة', 'Minute')} value={time[1]} onChange={(e) => emit(selected ?? today(), [time[0] ?? '00', e.target.value])}>
                  {Array.from({ length: 60 }, (_, m) => (
                    <option key={m} value={pad(m)}>
                      {pad(m)}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          ) : null}
          <div className="date-pop__foot">
            {clearable && value ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => (emit(null), close(true))}>
                {t('امسح', 'Clear')}
              </button>
            ) : null}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => close(true)}>
              {t('تمّ', 'Done')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
