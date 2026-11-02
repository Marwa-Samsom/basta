'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';

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
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkId = useId();
  const text = codes.join('\n');

  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true));
  };

  const download = () => {
    const note = t(
      'رموز استعادة حسابك في بسطة — كلٌّ يفتح الحساب مرة واحدة بدل رمز تطبيق المصادقة.\n' +
        'احفظها في مكان آمن بعيداً عن هاتفك.\n\n',
      'Your Basta account recovery codes — each one opens your account once instead of an authenticator app code.\n' +
        'Keep them somewhere safe, away from your phone.\n\n',
    );
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
        <p className="alert__title">{t('احفظ هذه الرموز الآن — لن تظهر مرة أخرى', "Save these codes now — they won't be shown again")}</p>
        <p>
          {t(
            'إن أضعت هاتفك فكل رمز منها يفتح حسابك مرة واحدة بدل رمز التطبيق. احفظها بعيداً عن الهاتف: ورقة أو مدير كلمات مرور.',
            'If you lose your phone, each code opens your account once instead of the app code. Keep them away from your phone: on paper or in a password manager.',
          )}
        </p>
      </div>

      <ol className="rc__list num" aria-label={t('رموز الاستعادة', 'Recovery codes')}>
        {codes.map((c) => (
          <li key={c} className="rc__code">
            {c}
          </li>
        ))}
      </ol>

      <div className="rc__actions">
        <button type="button" className="btn btn--secondary" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          {copied ? t('نُسخت الرموز', 'Codes copied') : t('انسخ الرموز', 'Copy codes')}
        </button>
        <button type="button" className="btn btn--secondary" onClick={download}>
          <Icon name="download" size={16} />
          {t('نزّلها ملفاً', 'Download as a file')}
        </button>
      </div>

      <label className="rc__confirm" htmlFor={checkId}>
        <input id={checkId} type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('حفظت الرموز في مكان آمن', "I've saved the codes somewhere safe")}
      </label>

      <button type="button" className="btn btn--primary btn--block" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
