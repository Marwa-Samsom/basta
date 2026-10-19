'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

export interface ConfirmRequest {
  /** السؤال نفسه — عنوان النافذة */
  title: string;
  /** ما يترتّب على الموافقة، سطر أو سطران */
  body?: ReactNode;
  /** فعل الزرّ كما يُقال: «ألغِ الطلب»، «احذف الفئة» — لا «نعم» ولا «موافق» */
  confirmLabel: string;
  /** يُتلف أو يُلغي أو يسحب صلاحية: زرّ الخطر، والتركيز يبدأ على «تراجع» */
  danger?: boolean;
}

type Ask = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** كلمات النافذة الثابتة بلغة الصفحة (`<html lang>`) — نصّ السؤال والفعل تكتبه الصفحة بلغتها */
const WORDS = {
  ar: { cancel: 'تراجع', close: 'إغلاق' },
  en: { cancel: 'Cancel', close: 'Close' },
} as const;

const wordsOf = (): (typeof WORDS)[keyof typeof WORDS] =>
  typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en') ? WORDS.en : WORDS.ar;

/**
 * نافذة تأكيد بتصميم الموقع ولغة الصفحة — بدل `window.confirm` التي يرسمها المتصفح
 * بلغته هو: «localhost:3000 says» (واسم النطاق في الإنتاج) وزرّا OK و Cancel بالإنجليزية
 * على صفحة عربية (SYS-096، J-04 — 19 أكتوبر 2026).
 *
 * `<dialog>` أصيل: `showModal` يحبس التركيز ويعطّل ما خلفها، و Esc والضغط على الخلفية
 * تراجع. نافذة واحدة للموقع كله في الجذر، والصفحة تسأل بـ `useConfirm()`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((request) => {
    // سؤال جديد قبل جواب القديم: القديم «تراجع»، لا وعدٌ معلّق إلى الأبد
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPending(request);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPending(null);
    resolve?.(ok);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (pending && !el.open) {
      el.showModal();
      // الخطِر يبدأ على «تراجع»: Enter عفويّ لا يلغي طلباً ولا يحذف شيئاً
      (pending.danger ? cancelButton : confirmButton).current?.focus();
    }
    if (!pending && el.open) el.close();
  }, [pending]);

  const words = wordsOf();

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={pending?.body ? 'confirm-dialog-body' : undefined}
        onClose={() => settle(false)}
        // الضغط على الخلفية: الهدف هو العنصر نفسه لا محتواه
        onClick={(e) => {
          if (e.target === e.currentTarget) settle(false);
        }}
      >
        {pending ? (
          <>
            <div className="confirm-dialog__head">
              <h2 className="confirm-dialog__title" id="confirm-dialog-title">
                {pending.title}
              </h2>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={words.close} onClick={() => settle(false)}>
                <Icon name="x" size={17} />
              </button>
            </div>
            {pending.body ? (
              <div className="confirm-dialog__body" id="confirm-dialog-body">
                {pending.body}
              </div>
            ) : null}
            <div className="confirm-dialog__foot">
              <button ref={cancelButton} type="button" className="btn btn--secondary" onClick={() => settle(false)}>
                {words.cancel}
              </button>
              <button
                ref={confirmButton}
                type="button"
                className={pending.danger ? 'btn btn--danger' : 'btn btn--primary'}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel}
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (!(await confirm({...}))) return;` */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm خارج ConfirmProvider — النافذة في الجذر (app/layout.tsx).');
  return ask;
}
