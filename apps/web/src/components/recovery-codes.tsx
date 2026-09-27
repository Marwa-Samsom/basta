'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * رموز الاستعادة — تُعرض **مرة واحدة** بعد التفعيل أو التجديد، ولا سبيل
 * لقراءتها بعدها (الخادم يحفظها مجزّأة). لذلك لا يمضي صاحبها قبل أن يقرّ
 * بأنه حفظها: من يتخطّاها ثم يضيع هاتفه يُقفل حسابه حتى يتدخّل الدعم.
 */
export function RecoveryCodes({
  codes,
  onDone,
  doneLabel,
}: {
  codes: readonly string[];
  onDone: () => void;
  doneLabel: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkId = useId();
  const text = codes.join('\n');

  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true));
  };

  const download = () => {
    const note =
      'رموز استعادة حسابك في بسطة — كلٌّ يفتح الحساب مرة واحدة بدل رمز تطبيق المصادقة.\n' +
      'احفظها في مكان آمن بعيداً عن هاتفك.\n\n';
    const url = URL.createObjectURL(new Blob([note + text + '\n'], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'basta-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rc">
      <div className="alert alert--warning" role="status">
        <p className="alert__title">احفظ هذه الرموز الآن — لن تظهر مرة أخرى</p>
        <p>
          إن أضعت هاتفك فكل رمز منها يفتح حسابك مرة واحدة بدل رمز التطبيق. احفظها بعيداً عن الهاتف: ورقة أو مدير
          كلمات مرور.
        </p>
      </div>

      <ol className="rc__list num" aria-label="رموز الاستعادة">
        {codes.map((c) => (
          <li key={c} className="rc__code">
            {c}
          </li>
        ))}
      </ol>

      <div className="rc__actions">
        <button type="button" className="btn btn--secondary" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          {copied ? 'نُسخت الرموز' : 'انسخ الرموز'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={download}>
          <Icon name="download" size={16} />
          نزّلها ملفاً
        </button>
      </div>

      <label className="rc__confirm" htmlFor={checkId}>
        <input id={checkId} type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        حفظت الرموز في مكان آمن
      </label>

      <button type="button" className="btn btn--primary btn--block" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
