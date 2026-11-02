'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ClearableInput, Field } from '@/components/ui';
import { localized } from '@/lib/i18n';

/** الحدّ الذي يفرضه الخادم (MIN_PASSWORD_LENGTH) — الواجهة لا تخترع قاعدة ثانية */
export const MIN_PASSWORD = 8;

/**
 * القوة بالطول وحده، كما يقول التلميح: العبارة الطويلة أقوى من الرموز.
 * أقلّ من ثمانية يرفضه الخادم فهو «ضعيفة»، ومن اثني عشر فأكثر «قوية».
 */
export const STRENGTH_LABEL = ['—', 'ضعيفة', 'متوسطة', 'قوية'] as const;
export const STRENGTH_LABEL_EN = ['—', 'Weak', 'Medium', 'Strong'] as const;
export function strength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  if (password.length < MIN_PASSWORD) return 1;
  return password.length < 12 ? 2 : 3;
}

/**
 * كلمة مرور جديدة: زرّ إظهار في طرف الحقل و✕ في طرفه الآخر، وشريط قوّة تحته (SH-02 · SH-04 · ST-25).
 * اسم الزرّ لا يحوي «كلمة المرور»: التسمية تخصّ الحقل وحده.
 */
export function NewPasswordField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [shown, setShown] = useState(false);
  const level = strength(value);
  return (
    <Field
      label={label}
      hint={
        hint ??
        t(
          'ثمانية أحرف على الأقل. العبارة الطويلة أقوى من الرموز المعقّدة.',
          'At least eight characters. A long phrase beats complex symbols.',
        )
      }
    >
      {(props) => (
        <>
          <span className="ac-pw">
            <ClearableInput
              className="field__control"
              type={shown ? 'text' : 'password'}
              autoComplete="new-password"
              dir="ltr"
              required
              minLength={MIN_PASSWORD}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              {...props}
            />
            <button
              type="button"
              className="ac-pw__toggle"
              aria-label={t('إظهار الحروف', 'Show characters')}
              aria-pressed={shown}
              onClick={() => setShown((s) => !s)}
            >
              <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
            </button>
          </span>
          <span className="ac-strength" data-level={level}>
            <span className="ac-strength__track" aria-hidden>
              <span className="ac-strength__fill" />
            </span>
            <span className="ac-strength__label" aria-live="polite">
              <span className="visually-hidden">{t('القوة: ', 'Strength: ')}</span>
              {localized<readonly string[]>(locale, STRENGTH_LABEL, STRENGTH_LABEL_EN)[level]}
            </span>
          </span>
        </>
      )}
    </Field>
  );
}

/** البريد يُنقل من «نسيت» إلى صفحة التعيين في ذاكرة الجلسة لا في الرابط — الرابط يُسجَّل ويُشارك */
export const RESET_EMAIL_KEY = 'basta.resetEmail';
