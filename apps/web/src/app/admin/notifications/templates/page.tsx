'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon, type IconName } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ClearableInput, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { counted, type Counted } from '@/lib/arabic-count';
import { localized } from '@/lib/i18n';
import { when } from '@/lib/orders';

/** «متغيّر واحد مجهول…»، «متغيّران مجهولان…»، «3 متغيّرات مجهولة…» — لا «3 متغيّر مجهول» */
const UNKNOWN: Counted = {
  one: 'متغيّر واحد مجهول لن يُستبدل',
  two: 'متغيّران مجهولان لن يُستبدلا',
  plural: '# متغيّرات مجهولة لن تُستبدل',
  accusative: '# متغيّراً مجهولاً لن يُستبدل',
  genitive: '# متغيّر مجهول لن يُستبدل',
};

interface Template {
  channel: string;
  subject: string | null;
  body: string;
  isEnabled: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  updatedAt: string;
}

interface Matrix {
  channels: { code: string; label: string }[];
  events: {
    code: string;
    labelAr: string;
    audience: string;
    variables: string[];
    sample: Record<string, string>;
    /** قالب رمز أمان: نصّه وقنواته من الكود — يُعرض ولا يُحرَّر */
    locked?: boolean;
    /** تنبيه أمن: يُحرَّر نصّه ولا يُوقف */
    mandatory?: boolean;
    templates: Template[];
    /** النصّ الإنجليزي لمن لغة حسابه الإنجليزية — تشغيله من العربي */
    templatesEn: Omit<Template, 'isEnabled'>[];
    /** العيّنة كما تصل بالإنجليزية: المبلغ «JOD 125.500» والحالات مترجمة */
    sampleEn: Record<string, string>;
  }[];
}

/** لغة نصّ الإشعار — غير لغة اللوحة: المدير بالعربية يحرّر النصّ الإنجليزي كما هو */
type TextLang = 'ar' | 'en';

/** نصوص الحدث بلغة: الإنجليزية تأخذ تشغيلها من العربية — أصل القناة */
const textsOf = (e: Matrix['events'][number], lang: TextLang): Template[] =>
  lang === 'ar'
    ? e.templates
    : e.templatesEn.map((x) => ({ ...x, isEnabled: e.templates.find((a) => a.channel === x.channel)?.isEnabled ?? true }));

/** حالة الخانة في المصفوفة — لونها ونصّها وأيقونتها */
const CELL: Record<'empty' | 'off' | 'reviewed' | 'unreviewed' | 'locked', { label: string; en: string; icon: IconName }> = {
  empty: { label: 'أضف', en: 'Add', icon: 'plus' },
  off: { label: 'موقوف', en: 'Off', icon: 'minus' },
  reviewed: { label: 'مراجَع', en: 'Reviewed', icon: 'check' },
  unreviewed: { label: 'بلا مراجعة', en: 'Not reviewed', icon: 'alert' },
  locked: { label: 'مقفول', en: 'Locked', icon: 'lock' },
};

/** أسماء القنوات بالإنجليزية — الخادم يرسلها بالعربية وحدها (CHANNEL_LABELS) */
const CHANNEL_EN: Record<string, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', push: 'Browser push', in_app: 'On-site' };

/**
 * AD-20 — قوالب الإشعارات: حدث × قناة. المحرّر بمتغيّرات تُدرج بالنقر،
 * ومعاينة ببيانات عيّنة، و«أرسل تجربة» تصل حسابك فعلاً. التعديل يُسقط
 * المراجعة اللغوية حتى يوقّعها مراجِع — بوابة 11 البند الثالث.
 */
/** لمن يصل الحدث — admin: من يحمل صلاحيته من المديرين وحدهم */
const AUDIENCE_AR: Record<string, string> = { customer: 'للمشتري', vendor: 'للبائع', admin: 'للإدارة' };
const AUDIENCE_EN: Record<string, string> = { customer: 'For buyers', vendor: 'For sellers', admin: 'For admins' };

export default function AdminNotificationsPage() {
  const t = useT();
  const locale = useLocale();
  const audience = localized(locale, AUDIENCE_AR, AUDIENCE_EN);
  const { data, error, forbidden, reload } = useAdminData<Matrix>('/admin/notifications/templates');
  const [sel, setSel] = useState<{ code: string; channel: string } | null>(null);
  const [lang, setLang] = useState<TextLang>('ar');

  if (!data) return <Loading error={error} forbidden={forbidden} />;
  const unreviewed = data.events.flatMap((e) => textsOf(e, lang)).filter((x) => !x.reviewedAt).length;
  const channelLabel = (c: { code: string; label: string }) => (locale === 'en' ? (CHANNEL_EN[c.code] ?? c.label) : c.label);

  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('قوالب الإشعارات', 'Notification templates')}
        hint={
          unreviewed
            ? t(`${unreviewed} قالب بلا مراجعة لغوية`, `${unreviewed} ${unreviewed === 1 ? 'template' : 'templates'} without a language review`)
            : t('كل القوالب مراجَعة', 'All templates reviewed')
        }
      />
      <section className="card card--flush" aria-label={t('مصفوفة الحدث × القناة', 'Event × channel matrix')}>
        <header className="card__head">
          <h2 className="ac2-title">{t('مصفوفة الحدث × القناة', 'Event × channel matrix')}</h2>
          <span className="ac2-hint">{t('اضغط خانة لتحرير قالبها.', 'Click a cell to edit its template.')}</span>
          {/* يصل كلَّ صاحب حساب بلغة حسابه: الإنجليزي لمن اختار الإنجليزية، والعربي لمن سواه */}
          <div className="seg" role="group" aria-label={t('لغة نصّ الإشعار', 'Notification text language')}>
            <button type="button" className="seg__opt" lang="ar" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>
              العربية
            </button>
            <button type="button" className="seg__opt" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              English
            </button>
          </div>
          <span className="ac2-end">
            {unreviewed ? (
              <span className="badge badge--warning">{t(`${unreviewed} بلا مراجعة`, `${unreviewed} not reviewed`)}</span>
            ) : (
              <span className="badge badge--success">{t('كلها مراجَعة', 'All reviewed')}</span>
            )}
          </span>
        </header>
        <div className="table-wrap">
          <table className="table ac2-matrix">
            <thead>
              <tr>
                <th scope="col">{t('الحدث', 'Event')}</th>
                {data.channels.map((c) => (
                  <th key={c.code} scope="col">
                    {channelLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.code}>
                  <td>
                    <span className="ac2-cell">
                      <span className="ac2-cell__main">{e.labelAr}</span>
                      <span className="ac2-cell__sub">{audience[e.audience] ?? e.audience}</span>
                    </span>
                  </td>
                  {data.channels.map((c) => {
                    const tpl = textsOf(e, lang).find((x) => x.channel === c.code);
                    // قالب مقفول بلا هذه القناة: لا خانة تُضاف — القنوات من الكود
                    if (e.locked && !tpl) {
                      return (
                        <td key={c.code} data-label={channelLabel(c)}>
                          <span className="ac2-faint" aria-label={t(`${e.labelAr} · ${c.label}: غير متاح`, `${e.labelAr} · ${channelLabel(c)}: not available`)}>
                            —
                          </span>
                        </td>
                      );
                    }
                    // القناة تُفتح بنصّها العربي: الإرسال يمشي على قنواته، فنصّ إنجليزي وحده لا يصل أحداً
                    if (lang === 'en' && !e.templates.some((x) => x.channel === c.code)) {
                      const why = t('أضف نصّها العربي أولاً', 'add its Arabic text first');
                      return (
                        <td key={c.code} data-label={channelLabel(c)}>
                          <span className="ac2-faint" title={why} aria-label={t(`${e.labelAr} · ${c.label}: ${why}`, `${e.labelAr} · ${channelLabel(c)}: ${why}`)}>
                            —
                          </span>
                        </td>
                      );
                    }
                    const state = e.locked ? 'locked' : !tpl ? 'empty' : !tpl.isEnabled ? 'off' : tpl.reviewedAt ? 'reviewed' : 'unreviewed';
                    const pressed = sel?.code === e.code && sel.channel === c.code;
                    return (
                      <td key={c.code} data-label={channelLabel(c)}>
                        <button
                          type="button"
                          className="ac2-cellbtn"
                          data-state={state}
                          aria-pressed={pressed}
                          aria-label={t(`${e.labelAr} · ${c.label}: ${CELL[state].label}`, `${e.labelAr} · ${channelLabel(c)}: ${CELL[state].en}`)}
                          onClick={() => setSel({ code: e.code, channel: c.code })}
                        >
                          <Icon name={CELL[state].icon} size={12} />
                          {pressed ? t('محدّد', 'Selected') : t(CELL[state].label, CELL[state].en)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {sel && (lang === 'ar' || data.events.find((e) => e.code === sel.code)!.templates.some((x) => x.channel === sel.channel)) ? (
        <Editor
          key={`${sel.code}:${sel.channel}:${lang}`}
          event={data.events.find((e) => e.code === sel.code)!}
          channel={data.channels.find((c) => c.code === sel.channel)!}
          lang={lang}
          template={textsOf(data.events.find((e) => e.code === sel.code)!, lang).find((x) => x.channel === sel.channel) ?? null}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function Editor({
  event,
  channel,
  lang,
  template,
  onSaved,
}: {
  event: Matrix['events'][number];
  channel: { code: string; label: string };
  lang: TextLang;
  template: Template | null;
  onSaved: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const channelName = locale === 'en' ? (CHANNEL_EN[channel.code] ?? channel.label) : channel.label;
  const act = useAction();
  const locked = event.locked === true;
  // النصّ واتجاهه بلغته لا بلغة اللوحة، والعيّنة كما تصل من لغة حسابه لغته
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const sample = lang === 'en' ? event.sampleEn : event.sample;
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [enabled, setEnabled] = useState(template?.isEnabled ?? true);
  const [reviewer, setReviewer] = useState('');
  const [sent, setSent] = useState<{ status: string; recipient: string | null; deliveryRef: string | null; error: string | null } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const render = (text: string) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, v: string) => sample[v] ?? `{{${v}}}`);
  const insert = (v: string) => {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setBody((b) => b + token);
    const s = el.selectionStart ?? body.length;
    setBody(body.slice(0, s) + token + body.slice(el.selectionEnd ?? s));
  };
  const dirty = body !== (template?.body ?? '') || subject !== (template?.subject ?? '') || enabled !== (template?.isEnabled ?? true);

  // المعاينة مقاطع: المتغيّر المعروف يُستبدل بقيمة العيّنة مميَّزاً، والمجهول يبقى كما كُتب بلون الخطر
  const segments = body.split(/(\{\{[^}]*\}\})/).filter(Boolean).map((part) => {
    const m = /^\{\{\s*([^}]*?)\s*\}\}$/.exec(part);
    if (!m) return { text: part, token: false, unknown: false };
    const value = sample[m[1]!];
    return value !== undefined ? { text: value, token: true, unknown: false } : { text: part, token: true, unknown: true };
  });
  const unknown = segments.filter((s) => s.unknown).length;
  const bodyId = `tpl-body-${event.code}-${channel.code}`;

  return (
    <div className="ac2-split ac2-split--half">
      <section className="card ac2-editor" aria-label={t(`قالب ${event.labelAr} · ${channel.label}`, `Template ${event.labelAr} · ${channelName}`)}>
        <div className="ac2-inline">
          <h2 className="ac2-title">{event.labelAr}</h2>
          <span className="badge badge--pending">{channelName}</span>
          <span className="badge" lang={lang}>
            {lang === 'en' ? 'English' : 'العربية'}
          </span>
          {template ? (
            template.reviewedAt ? (
              <span className="badge badge--success">{t('مراجَع', 'Reviewed')}</span>
            ) : (
              <span className="badge badge--warning">{t('بلا مراجعة', 'Not reviewed')}</span>
            )
          ) : (
            <span className="badge">{t('جديد', 'New')}</span>
          )}
        </div>
        <Feedback error={act.error} notice={act.notice} />
        {locked ? (
          <div className="alert alert--info ac2-callout ac2-callout--sm" role="note">
            <Icon name="lock" size={14} />
            <span>
              {t(
                'قالب رمز أمان: نصّه وقنواته مثبّتة في الكود ولا تُحرَّر من اللوحة، والرمز يُمحى من السجل بعد الإرسال — فلا يقرؤه أحد غير صاحب الحساب.',
                'Security code template: its text and channels are fixed in the code and cannot be edited from the dashboard, and the code is erased from the log after sending — so no one but the account owner can read it.',
              )}
            </span>
          </div>
        ) : (
          <div className="ac2-vars" role="group" aria-label={t('المتغيّرات', 'Variables')}>
            {event.variables.map((v) => (
              <button key={v} type="button" className="ac2-var" onClick={() => insert(v)}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        )}
        {channel.code === 'email' || channel.code === 'push' ? (
          <TextInput
            label={channel.code === 'email' ? t('العنوان', 'Subject') : t('العنوان (اختياري)', 'Title (optional)')}
            value={subject}
            dir={dir}
            lang={lang}
            readOnly={locked}
            onChange={(e) => setSubject(e.target.value)}
          />
        ) : null}
        <div className="field">
          <span className="ac2-labelrow">
            <label className="field__label" htmlFor={bodyId}>
              {t('النص', 'Text')}
            </label>
            <span className="ac2-counter">{render(body).length}</span>
          </span>
          <textarea id={bodyId} ref={bodyRef} className="field__control" dir={dir} lang={lang} rows={channel.code === 'email' ? 10 : 6} value={body} readOnly={locked} onChange={(e) => setBody(e.target.value)} />
          {channel.code === 'sms' ? (
            <span className="field__hint">
              {lang === 'en'
                ? t(
                    `${render(body).length} حرفاً — الرسالة النصية الواحدة نحو 160 حرفاً لاتينياً.`,
                    `${render(body).length} characters — one text message holds about 160 Latin characters.`,
                  )
                : t(
                    `${render(body).length} حرفاً — الرسالة النصية الواحدة نحو 70 حرفاً عربياً.`,
                    `${render(body).length} characters — one text message holds about 70 Arabic characters.`,
                  )}
            </span>
          ) : null}
        </div>
        {locked ? null : (
          <div className="ac2-setting__row">
            <span className="ac2-setting__label">
              <span className="field__label">{t('مفعّل', 'Enabled')}</span>
              <span className="ac2-fine">
                {event.mandatory
                  ? t(
                      'تنبيه أمن إلزامي — يُحرَّر نصّه ولا يُوقف، فإيقافه يُخفي عن صاحب الحساب أن حسابه في خطر.',
                      'Mandatory security alert — its text can be edited but it cannot be turned off, since that would hide from the account owner that their account is at risk.',
                    )
                  : t(
                      'الموقوف لا يُرسل على هذه القناة بالعربية ولا بالإنجليزية.',
                      'When off, nothing is sent on this channel, in Arabic or in English.',
                    )}
              </span>
            </span>
            <button type="button" role="switch" className="ac2-switch" aria-checked={enabled} aria-label={t('مفعّل', 'Enabled')} disabled={event.mandatory} onClick={() => setEnabled(!enabled)} />
          </div>
        )}
        <div className="ac2-form__actions">
          {locked ? null : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || !dirty || body.trim().length < 5}
              onClick={() =>
                void act.run(async () => {
                  await api(`/admin/notifications/templates/${event.code}/${channel.code}`, { method: 'PUT', body: { subject: subject || undefined, body, isEnabled: enabled, locale: lang } });
                  onSaved();
                }, t('حُفظ القالب — يحتاج مراجعة لغوية قبل اعتماده.', 'Template saved — it needs a language review before it is approved.'))
              }
            >
              {t('احفظ القالب', 'Save template')}
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={act.busy || !template || dirty}
            onClick={() =>
              void act.run(async () => {
                setSent(await api(`/admin/notifications/templates/${event.code}/${channel.code}/test`, { method: 'POST', body: { locale: lang } }));
              })
            }
          >
            <Icon name="send" size={15} />
            {t('أرسل تجربة لي', 'Send me a test')}
          </button>
        </div>
        {sent ? (
          <div className={`alert ac2-callout ac2-callout--sm ${sent.status === 'sent' ? 'alert--success' : 'alert--danger'}`} role="status">
            <Icon name={sent.status === 'sent' ? 'check-circle' : 'alert'} size={14} />
            <span>
              {sent.status === 'sent'
                ? t(`وصلت إلى ${sent.recipient} — ${sent.deliveryRef}`, `Delivered to ${sent.recipient} — ${sent.deliveryRef}`)
                : t(`لم تُرسل: ${sent.error}`, `Not sent: ${sent.error}`)}
            </span>
          </div>
        ) : null}
        {template ? (
          <div className="ac2-divider">
            <span className="ac2-fine">
              {template.reviewedAt
                ? t(`راجعه لغوياً: ${template.reviewedBy} · ${when(template.reviewedAt, locale)}`, `Language review: ${template.reviewedBy} · ${when(template.reviewedAt, locale)}`)
                : t('لم يُراجَع لغوياً بعد.', 'No language review yet.')}
            </span>
            {!template.reviewedAt ? (
              <div className="ac2-inline">
                <ClearableInput
                  className="field__control"
                  aria-label={t('اسم المراجِع', 'Reviewer name')}
                  placeholder={t('اسم المراجِع', 'Reviewer name')}
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={act.busy || reviewer.trim().length < 2 || dirty}
                  onClick={() =>
                    void act.run(async () => {
                      await api(`/admin/notifications/templates/${event.code}/${channel.code}/review`, { method: 'POST', body: { reviewer: reviewer.trim(), locale: lang } });
                      onSaved();
                    }, t('سُجّلت المراجعة.', 'Review recorded.'))
                  }
                >
                  <Icon name="check" size={14} />
                  {t('راجعتُ النص لغوياً', 'I reviewed the language')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card ac2-sticky" aria-label={t('معاينة', 'Preview')}>
        <span className="ac2-eyebrow">{t('معاينة · ببيانات مثال', 'Preview · with sample data')}</span>
        <div className="ac2-preview" dir={dir} lang={lang}>
          {subject ? <span className="ac2-preview__subject">{render(subject)}</span> : null}
          <div className="ac2-preview__body">
            {segments.length === 0 ? <span className="ac2-faint">{t('النص فارغ.', 'The text is empty.')}</span> : null}
            {segments.map((s, i) =>
              s.token ? (
                <span key={i} className="ac2-token" data-unknown={s.unknown}>
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
        </div>
        <p className={unknown ? 'ac2-fine ac2-note-danger' : 'ac2-fine'}>
          {unknown
            ? t(`${counted(unknown, UNKNOWN)} عند الإرسال.`, `${unknown} unknown ${unknown === 1 ? 'variable' : 'variables'} will not be replaced when sending.`)
            : t('كل المتغيّرات معروفة وستُستبدل ببيانات الطلب.', 'All variables are known and will be replaced with the order data.')}
        </p>
      </section>
    </div>
  );
}
