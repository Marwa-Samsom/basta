'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon, type IconName } from '@/components/icons';
import { ClearableInput, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

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
  }[];
}

/** حالة الخانة في المصفوفة — لونها ونصّها وأيقونتها */
const CELL: Record<'empty' | 'off' | 'reviewed' | 'unreviewed' | 'locked', { label: string; icon: IconName }> = {
  empty: { label: 'أضف', icon: 'plus' },
  off: { label: 'موقوف', icon: 'minus' },
  reviewed: { label: 'مراجَع', icon: 'check' },
  unreviewed: { label: 'بلا مراجعة', icon: 'alert' },
  locked: { label: 'مقفول', icon: 'lock' },
};

/**
 * AD-20 — قوالب الإشعارات: حدث × قناة. المحرّر بمتغيّرات تُدرج بالنقر،
 * ومعاينة ببيانات عيّنة، و«أرسل تجربة» تصل حسابك فعلاً. التعديل يُسقط
 * المراجعة اللغوية حتى يوقّعها مراجِع — بوابة 11 البند الثالث.
 */
/** لمن يصل الحدث — admin: من يحمل صلاحيته من المديرين وحدهم */
const AUDIENCE_AR: Record<string, string> = { customer: 'للمشتري', vendor: 'للبائع', admin: 'للإدارة' };

export default function AdminNotificationsPage() {
  const { data, error, forbidden, reload } = useAdminData<Matrix>('/admin/notifications/templates');
  const [sel, setSel] = useState<{ code: string; channel: string } | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} />;
  const unreviewed = data.events.flatMap((e) => e.templates).filter((t) => !t.reviewedAt).length;

  return (
    <div className="ac2-page">
      <AdminHeader title="قوالب الإشعارات" hint={unreviewed ? `${unreviewed} قالب بلا مراجعة لغوية` : 'كل القوالب مراجَعة'} />
      <section className="card card--flush" aria-label="مصفوفة الحدث × القناة">
        <header className="card__head">
          <h2 className="ac2-title">مصفوفة الحدث × القناة</h2>
          <span className="ac2-hint">اضغط خانة لتحرير قالبها.</span>
          <span className="ac2-end">{unreviewed ? <span className="badge badge--warning">{unreviewed} بلا مراجعة</span> : <span className="badge badge--success">كلها مراجَعة</span>}</span>
        </header>
        <div className="table-wrap">
          <table className="table ac2-matrix">
            <thead>
              <tr>
                <th scope="col">الحدث</th>
                {data.channels.map((c) => (
                  <th key={c.code} scope="col">
                    {c.label}
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
                      <span className="ac2-cell__sub">{AUDIENCE_AR[e.audience] ?? e.audience}</span>
                    </span>
                  </td>
                  {data.channels.map((c) => {
                    const t = e.templates.find((x) => x.channel === c.code);
                    // قالب مقفول بلا هذه القناة: لا خانة تُضاف — القنوات من الكود
                    if (e.locked && !t) {
                      return (
                        <td key={c.code} data-label={c.label}>
                          <span className="ac2-faint" aria-label={`${e.labelAr} · ${c.label}: غير متاح`}>
                            —
                          </span>
                        </td>
                      );
                    }
                    const state = e.locked ? 'locked' : !t ? 'empty' : !t.isEnabled ? 'off' : t.reviewedAt ? 'reviewed' : 'unreviewed';
                    const pressed = sel?.code === e.code && sel.channel === c.code;
                    return (
                      <td key={c.code} data-label={c.label}>
                        <button
                          type="button"
                          className="ac2-cellbtn"
                          data-state={state}
                          aria-pressed={pressed}
                          aria-label={`${e.labelAr} · ${c.label}: ${CELL[state].label}`}
                          onClick={() => setSel({ code: e.code, channel: c.code })}
                        >
                          <Icon name={CELL[state].icon} size={12} />
                          {pressed ? 'محدّد' : CELL[state].label}
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
      {sel ? (
        <Editor
          key={`${sel.code}:${sel.channel}`}
          event={data.events.find((e) => e.code === sel.code)!}
          channel={data.channels.find((c) => c.code === sel.channel)!}
          template={data.events.find((e) => e.code === sel.code)!.templates.find((t) => t.channel === sel.channel) ?? null}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function Editor({ event, channel, template, onSaved }: { event: Matrix['events'][number]; channel: { code: string; label: string }; template: Template | null; onSaved: () => void }) {
  const act = useAction();
  const locked = event.locked === true;
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [enabled, setEnabled] = useState(template?.isEnabled ?? true);
  const [reviewer, setReviewer] = useState('');
  const [sent, setSent] = useState<{ status: string; recipient: string | null; deliveryRef: string | null; error: string | null } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const render = (t: string) => t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, v: string) => event.sample[v] ?? `{{${v}}}`);
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
    const value = event.sample[m[1]!];
    return value !== undefined ? { text: value, token: true, unknown: false } : { text: part, token: true, unknown: true };
  });
  const unknown = segments.filter((s) => s.unknown).length;
  const bodyId = `tpl-body-${event.code}-${channel.code}`;

  return (
    <div className="ac2-split ac2-split--half">
      <section className="card ac2-editor" aria-label={`قالب ${event.labelAr} · ${channel.label}`}>
        <div className="ac2-inline">
          <h2 className="ac2-title">{event.labelAr}</h2>
          <span className="badge badge--pending">{channel.label}</span>
          {template ? template.reviewedAt ? <span className="badge badge--success">مراجَع</span> : <span className="badge badge--warning">بلا مراجعة</span> : <span className="badge">جديد</span>}
        </div>
        <Feedback error={act.error} notice={act.notice} />
        {locked ? (
          <div className="alert alert--info ac2-callout ac2-callout--sm" role="note">
            <Icon name="lock" size={14} />
            <span>قالب رمز أمان: نصّه وقنواته مثبّتة في الكود ولا تُحرَّر من اللوحة، والرمز يُمحى من السجل بعد الإرسال — فلا يقرؤه أحد غير صاحب الحساب.</span>
          </div>
        ) : (
          <div className="ac2-vars" role="group" aria-label="المتغيّرات">
            {event.variables.map((v) => (
              <button key={v} type="button" className="ac2-var" onClick={() => insert(v)}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        )}
        {channel.code === 'email' || channel.code === 'push' ? <TextInput label={channel.code === 'email' ? 'العنوان' : 'العنوان (اختياري)'} value={subject} readOnly={locked} onChange={(e) => setSubject(e.target.value)} /> : null}
        <div className="field">
          <span className="ac2-labelrow">
            <label className="field__label" htmlFor={bodyId}>
              النص
            </label>
            <span className="ac2-counter">{render(body).length}</span>
          </span>
          <textarea id={bodyId} ref={bodyRef} className="field__control" rows={channel.code === 'email' ? 10 : 6} value={body} readOnly={locked} onChange={(e) => setBody(e.target.value)} />
          {channel.code === 'sms' ? <span className="field__hint">{render(body).length} حرفاً — الرسالة النصية الواحدة نحو 70 حرفاً عربياً.</span> : null}
        </div>
        {locked ? null : (
          <div className="ac2-setting__row">
            <span className="ac2-setting__label">
              <span className="field__label">مفعّل</span>
              <span className="ac2-fine">{event.mandatory ? 'تنبيه أمن إلزامي — يُحرَّر نصّه ولا يُوقف، فإيقافه يُخفي عن صاحب الحساب أن حسابه في خطر.' : 'الموقوف لا يُرسل على هذه القناة.'}</span>
            </span>
            <button type="button" role="switch" className="ac2-switch" aria-checked={enabled} aria-label="مفعّل" disabled={event.mandatory} onClick={() => setEnabled(!enabled)} />
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
                  await api(`/admin/notifications/templates/${event.code}/${channel.code}`, { method: 'PUT', body: { subject: subject || undefined, body, isEnabled: enabled } });
                  onSaved();
                }, 'حُفظ القالب — يحتاج مراجعة لغوية قبل اعتماده.')
              }
            >
              احفظ القالب
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={act.busy || !template || dirty}
            onClick={() =>
              void act.run(async () => {
                setSent(await api(`/admin/notifications/templates/${event.code}/${channel.code}/test`, { method: 'POST' }));
              })
            }
          >
            <Icon name="send" size={15} />
            أرسل تجربة لي
          </button>
        </div>
        {sent ? (
          <div className={`alert ac2-callout ac2-callout--sm ${sent.status === 'sent' ? 'alert--success' : 'alert--danger'}`} role="status">
            <Icon name={sent.status === 'sent' ? 'check-circle' : 'alert'} size={14} />
            <span>{sent.status === 'sent' ? `وصلت إلى ${sent.recipient} — ${sent.deliveryRef}` : `لم تُرسل: ${sent.error}`}</span>
          </div>
        ) : null}
        {template ? (
          <div className="ac2-divider">
            <span className="ac2-fine">{template.reviewedAt ? `راجعه لغوياً: ${template.reviewedBy} · ${when(template.reviewedAt)}` : 'لم يُراجَع لغوياً بعد.'}</span>
            {!template.reviewedAt ? (
              <div className="ac2-inline">
                <ClearableInput className="field__control" aria-label="اسم المراجِع" placeholder="اسم المراجِع" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={act.busy || reviewer.trim().length < 2 || dirty}
                  onClick={() =>
                    void act.run(async () => {
                      await api(`/admin/notifications/templates/${event.code}/${channel.code}/review`, { method: 'POST', body: { reviewer: reviewer.trim() } });
                      onSaved();
                    }, 'سُجّلت المراجعة.')
                  }
                >
                  <Icon name="check" size={14} />
                  راجعتُ النص لغوياً
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card ac2-sticky" aria-label="معاينة">
        <span className="ac2-eyebrow">معاينة · ببيانات مثال</span>
        <div className="ac2-preview">
          {subject ? <span className="ac2-preview__subject">{render(subject)}</span> : null}
          <div className="ac2-preview__body">
            {segments.length === 0 ? <span className="ac2-faint">النص فارغ.</span> : null}
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
        <p className={unknown ? 'ac2-fine ac2-note-danger' : 'ac2-fine'}>{unknown ? `${unknown} متغيّر مجهول لن يُستبدل عند الإرسال.` : 'كل المتغيّرات معروفة وستُستبدل ببيانات الطلب.'}</p>
      </section>
    </div>
  );
}
