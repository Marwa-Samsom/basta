'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';

/**
 * SH-06 — خلل غير متوقّع (500). حدّ الخطأ في جذر التطبيق: يقول ماذا تفعل الآن،
 * ويعطي الرقم المرجعي الذي يولّده Next للخطأ (`digest`) ليُبلَّغ به — إن وُجد.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
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
        <h1 className="ac-state__title">
          {t('حدث خلل غير متوقّع ولم يكتمل طلبك', "Something unexpected went wrong and your request wasn't completed")}
        </h1>
        <p className="ac-state__body">
          {ref
            ? t('أعد المحاولة، وإن تكرّر أبلغنا بالرقم أدناه.', 'Try again, and if it happens again, report it to us with the number below.')
            : t('أعد المحاولة، وإن تكرّر تواصل معنا.', 'Try again, and if it happens again, contact us.')}
        </p>

        {ref ? (
          <div className="ac-ref">
            <span className="ac-ref__label">{t('رقم الطلب المرجعي', 'Reference number')}</span>
            <span className="ac-ref__value num">{ref}</span>
            <button type="button" className="icon-btn" aria-label={t('انسخ الرقم', 'Copy number')} onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
            </button>
          </div>
        ) : null}
        {copied ? (
          <span className="ac-copied" role="status">
            {t('نُسخ الرقم.', 'Number copied.')}
          </span>
        ) : null}

        <div className="ac-state__actions">
          <button type="button" className="btn btn--primary" onClick={() => reset()}>
            <Icon name="refresh" size={16} />
            {t('أعد المحاولة', 'Try again')}
          </button>
          <Link className="btn btn--secondary" href="/pages/contact">
            {t('تواصل معنا', 'Contact us')}
          </Link>
        </div>
      </div>
    </main>
  );
}
