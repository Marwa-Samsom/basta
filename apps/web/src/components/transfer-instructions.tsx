'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { intlLocale, type Locale } from '@/lib/i18n';
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

const deadline = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));

/** سطر يُنسخ بضغطة — المبلغ والاسم المستعار والآيبان ورقم الطلب تُلصق في تطبيق البنك كما هي */
function CopyRow({ label, value, hint, latin = true }: { label: string; value: string; hint?: string; latin?: boolean }) {
  const t = useT();
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
      <button type="button" className="icon-btn" aria-label={t(`انسخ ${label}`, `Copy: ${label}`)} onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={16} />
      </button>
      <span className="visually-hidden" role="status">
        {copied ? t(`نُسخ ${label}`, `Copied: ${label}`) : ''}
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
  transfer: tr,
  amount,
  amountMinor,
}: {
  transfer: TransferInstructionsView;
  /** المبلغ منسّقاً للعرض */
  amount: string;
  /** المبلغ كما يُكتب في تطبيق البنك — أرقام بفاصلة عشرية */
  amountMinor: string;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="sp-transfer" aria-labelledby="transfer-title">
      <h2 className="sp-transfer__title" id="transfer-title">
        {t('حوّل المبلغ إلى', 'Transfer the amount to')}
      </h2>
      <dl className="sp-transfer__rows">
        <CopyRow label={t('المبلغ بالضبط', 'Exact amount')} value={amountMinor} hint={amount} />
        {tr.cliqAlias ? <CopyRow label={t('كليك — الاسم المستعار', 'CliQ — alias')} value={tr.cliqAlias} /> : null}
        {tr.iban ? <CopyRow label="IBAN" value={tr.iban} /> : null}
        {tr.beneficiary ? <CopyRow label={t('اسم المستفيد', 'Beneficiary name')} value={tr.beneficiary} latin={false} /> : null}
        {tr.bank ? (
          <div className="sp-transfer__row">
            <dt>{t('البنك', 'Bank')}</dt>
            <dd>
              <span className="sp-transfer__value">{tr.bank}</span>
            </dd>
          </div>
        ) : null}
        <CopyRow
          label={t('اكتب في ملاحظة التحويل', 'Write in the transfer note')}
          value={tr.reference}
          hint={t('رقم طلبك — به نعرف أن التحويل لك', 'Your order number — it tells us the transfer is yours')}
        />
      </dl>
      <ol className="sp-transfer__steps">
        <li>{t('حوّل المبلغ نفسه من تطبيق بنكك — تحويل ناقص لا نستطيع تأكيده.', "Transfer the exact amount from your bank app — we can't confirm a short transfer.")}</li>
        <li>{t('اكتب رقم الطلب في ملاحظة التحويل.', 'Write the order number in the transfer note.')}</li>
        <li>{t('نؤكّد وصوله ونرسل الطلب إلى المتاجر، ونبلغك حينها.', 'We confirm it arrived, send the order to the shops, and let you know.')}</li>
      </ol>
      {tr.expiresAt ? (
        <p className="sp-transfer__deadline" role="note">
          <Icon name="clock" size={15} />
          <span>
            {t('القطع محجوزة لك حتى ', 'Your items are reserved until ')}
            <strong>{deadline(tr.expiresAt, locale)}</strong>
            {t(
              '. إن لم يصل التحويل حتى ذلك الموعد يُلغى الطلب تلقائياً.',
              ". If the transfer hasn't arrived by then, the order is cancelled automatically.",
            )}
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
