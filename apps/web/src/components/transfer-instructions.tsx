'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { minorUnitDigits } from '@/lib/money';

export interface TransferInstructionsView {
  reference: string;
  expiresAt: string | null;
  windowHours: number;
  beneficiary: string | null;
  bank: string | null;
  iban: string | null;
  cliqAlias: string | null;
}

const DEADLINE = new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'full', timeStyle: 'short' });

/** سطر يُنسخ بضغطة — المبلغ والاسم المستعار والآيبان ورقم الطلب تُلصق في تطبيق البنك كما هي */
function CopyRow({ label, value, hint, latin = true }: { label: string; value: string; hint?: string; latin?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };
  return (
    <div className="sp-transfer__row">
      <dt>{label}</dt>
      <dd>
        {latin ? (
          <bdi className="sp-transfer__value num" dir="ltr">
            {value}
          </bdi>
        ) : (
          <span className="sp-transfer__value">{value}</span>
        )}
        {hint ? <span className="sp-transfer__hint">{hint}</span> : null}
      </dd>
      <button type="button" className="icon-btn" aria-label={`انسخ ${label}`} onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={16} />
      </button>
      <span className="visually-hidden" role="status">
        {copied ? `نُسخ ${label}` : ''}
      </span>
    </div>
  );
}

/**
 * كيف يحوّل المشتري ثمن طلبه — بعد «أكّد الطلب» وفي صفحة الطلب حتى يصل التحويل.
 *
 * ثلاثة أشياء لا تُنسى: المبلغ بالضبط (تحويل ناقص لا يُؤكَّد)، ورقم الطلب في ملاحظة
 * التحويل (به نعرف أنه له)، والموعد (بعده يُلغى ويعود المخزون).
 */
export function TransferInstructions({
  transfer: t,
  amount,
  amountMinor,
}: {
  transfer: TransferInstructionsView;
  /** المبلغ منسّقاً للعرض */
  amount: string;
  /** المبلغ كما يُكتب في تطبيق البنك — أرقام بفاصلة عشرية */
  amountMinor: string;
}) {
  return (
    <section className="sp-transfer" aria-labelledby="transfer-title">
      <h2 className="sp-transfer__title" id="transfer-title">
        حوّل المبلغ إلى
      </h2>
      <dl className="sp-transfer__rows">
        <CopyRow label="المبلغ بالضبط" value={amountMinor} hint={amount} />
        {t.cliqAlias ? <CopyRow label="كليك — الاسم المستعار" value={t.cliqAlias} /> : null}
        {t.iban ? <CopyRow label="IBAN" value={t.iban} /> : null}
        {t.beneficiary ? <CopyRow label="اسم المستفيد" value={t.beneficiary} latin={false} /> : null}
        {t.bank ? (
          <div className="sp-transfer__row">
            <dt>البنك</dt>
            <dd>
              <span className="sp-transfer__value">{t.bank}</span>
            </dd>
          </div>
        ) : null}
        <CopyRow label="اكتب في ملاحظة التحويل" value={t.reference} hint="رقم طلبك — به نعرف أن التحويل لك" />
      </dl>
      <ol className="sp-transfer__steps">
        <li>حوّل المبلغ نفسه من تطبيق بنكك — تحويل ناقص لا نستطيع تأكيده.</li>
        <li>اكتب رقم الطلب في ملاحظة التحويل.</li>
        <li>نؤكّد وصوله ونرسل الطلب إلى المتاجر، ونبلغك حينها.</li>
      </ol>
      {t.expiresAt ? (
        <p className="sp-transfer__deadline" role="note">
          <Icon name="clock" size={15} />
          <span>
            القطع محجوزة لك حتى <strong>{DEADLINE.format(new Date(t.expiresAt))}</strong>. إن لم يصل التحويل حتى ذلك الموعد
            يُلغى الطلب تلقائياً.
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** المبلغ بأرقامه كما يُكتب في تطبيق البنك: 25.500 لا «25.500 د.أ» */
export function plainAmount(minor: string, currency: string): string {
  const digits = minorUnitDigits(currency);
  const n = BigInt(minor);
  if (digits === 0) return n.toString();
  const base = 10n ** BigInt(digits);
  return `${n / base}.${(n % base).toString().padStart(digits, '0')}`;
}
