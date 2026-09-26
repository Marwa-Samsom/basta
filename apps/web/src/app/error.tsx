'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * SH-06 — خلل غير متوقّع (500). حدّ الخطأ في جذر التطبيق: يقول ماذا تفعل الآن،
 * ويعطي الرقم المرجعي الذي يولّده Next للخطأ (`digest`) ليُبلَّغ به — إن وُجد.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = useState(false);
  const ref = error.digest;

  const copy = () => {
    if (!ref) return;
    void navigator.clipboard?.writeText(ref).then(() => setCopied(true));
  };

  return (
    <main className="ac-state">
      <div className="ac-state__box">
        <span className="ac-state__icon ac-state__icon--danger" aria-hidden>
          <Icon name="alert" size={32} />
        </span>
        <h1 className="ac-state__title">حدث خلل غير متوقّع ولم يكتمل طلبك</h1>
        <p className="ac-state__body">
          {ref ? 'أعد المحاولة، وإن تكرّر أبلغنا بالرقم أدناه.' : 'أعد المحاولة، وإن تكرّر تواصل معنا.'}
        </p>

        {ref ? (
          <div className="ac-ref">
            <span className="ac-ref__label">رقم الطلب المرجعي</span>
            <span className="ac-ref__value num">{ref}</span>
            <button type="button" className="icon-btn" aria-label="انسخ الرقم" onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
            </button>
          </div>
        ) : null}
        {copied ? (
          <span className="ac-copied" role="status">
            نُسخ الرقم.
          </span>
        ) : null}

        <div className="ac-state__actions">
          <button type="button" className="btn btn--primary" onClick={() => reset()}>
            <Icon name="refresh" size={16} />
            أعد المحاولة
          </button>
          <Link className="btn btn--secondary" href="/pages/contact">
            تواصل معنا
          </Link>
        </div>
      </div>
    </main>
  );
}
