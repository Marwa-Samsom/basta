'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { Field } from '@/components/ui';

/** الحدّ الذي يفرضه الخادم (MIN_PASSWORD_LENGTH) — الواجهة لا تخترع قاعدة ثانية */
export const MIN_PASSWORD = 8;

/**
 * القوة بالطول وحده، كما يقول التلميح: العبارة الطويلة أقوى من الرموز.
 * أقلّ من ثمانية يرفضه الخادم فهو «ضعيفة»، ومن اثني عشر فأكثر «قوية».
 */
export const STRENGTH_LABEL = ['—', 'ضعيفة', 'متوسطة', 'قوية'] as const;
export function strength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  if (password.length < MIN_PASSWORD) return 1;
  return password.length < 12 ? 2 : 3;
}

/**
 * كلمة مرور جديدة: زرّ إظهار في طرف الحقل، وشريط قوّة تحته (SH-02 · SH-04 · ST-25).
 * اسم الزرّ لا يحوي «كلمة المرور»: التسمية تخصّ الحقل وحده.
 */
export function NewPasswordField({
  label,
  value,
  onChange,
  hint = 'ثمانية أحرف على الأقل. العبارة الطويلة أقوى من الرموز المعقّدة.',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const level = strength(value);
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <>
          <span className="ac-pw">
            <input
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
              aria-label="إظهار الحروف"
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
              <span className="visually-hidden">القوة: </span>
              {STRENGTH_LABEL[level]}
            </span>
          </span>
        </>
      )}
    </Field>
  );
}

/** وجهة «التالي» من الرابط — مسار داخلي فقط، لا `//موقع-آخر` يحوّل إليه رابط مصنوع */
export function safeNext(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

/** البريد يُنقل من «نسيت» إلى صفحة التعيين في ذاكرة الجلسة لا في الرابط — الرابط يُسجَّل ويُشارك */
export const RESET_EMAIL_KEY = 'basta.resetEmail';
