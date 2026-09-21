'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Card, TextArea, TextInput } from '@/components/ui';
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
  events: { code: string; labelAr: string; audience: string; variables: string[]; sample: Record<string, string>; templates: Template[] }[];
}

/**
 * AD-20 — قوالب الإشعارات: حدث × قناة. المحرّر بمتغيّرات تُدرج بالنقر،
 * ومعاينة ببيانات عيّنة، و«أرسل تجربة» تصل حسابك فعلاً. التعديل يُسقط
 * المراجعة اللغوية حتى يوقّعها مراجِع — بوابة 11 البند الثالث.
 */
export default function AdminNotificationsPage() {
  const { data, error, forbidden, reload } = useAdminData<Matrix>('/admin/notifications/templates');
  const [sel, setSel] = useState<{ code: string; channel: string } | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} />;
  const unreviewed = data.events.flatMap((e) => e.templates).filter((t) => !t.reviewedAt).length;

  return (
    <div className="stack stack--loose">
      <AdminHeader title="قوالب الإشعارات" hint={unreviewed ? `${unreviewed} قالب بلا مراجعة لغوية` : 'كل القوالب مراجَعة'} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الحدث</th>
              {data.channels.map((c) => (
                <th key={c.code}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.code}>
                <td>
                  {e.labelAr}
                  <div className="small muted">{e.audience === 'vendor' ? 'للبائع' : 'للمشتري'}</div>
                </td>
                {data.channels.map((c) => {
                  const t = e.templates.find((x) => x.channel === c.code);
                  return (
                    <td key={c.code}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSel({ code: e.code, channel: c.code })} aria-pressed={sel?.code === e.code && sel.channel === c.code}>
                        {!t ? '＋' : !t.isEnabled ? 'موقوف' : t.reviewedAt ? '✓ مراجَع' : '⚠ بلا مراجعة'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

  return (
    <Card title={`${event.labelAr} · ${channel.label}`}>
      <div className="stack">
        <Feedback error={act.error} notice={act.notice} />
        <div className="chips" aria-label="المتغيّرات">
          {event.variables.map((v) => (
            <button key={v} type="button" className="chip" onClick={() => insert(v)}>
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        <div className="grid-2">
          <div className="stack">
            {channel.code === 'email' || channel.code === 'push' ? <TextInput label={channel.code === 'email' ? 'العنوان' : 'العنوان (اختياري)'} value={subject} onChange={(e) => setSubject(e.target.value)} /> : null}
            <label className="field">
              <span className="field__label">النص</span>
              <textarea ref={bodyRef} className="field__control" rows={channel.code === 'email' ? 10 : 4} value={body} onChange={(e) => setBody(e.target.value)} />
              {channel.code === 'sms' ? <span className="field__hint">{render(body).length} حرفاً — الرسالة النصية الواحدة نحو 70 حرفاً عربياً.</span> : null}
            </label>
            <label className="row small">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> مفعّل
            </label>
          </div>
          <div className="stack">
            <span className="small muted">معاينة ببيانات عيّنة</span>
            <div className="card" style={{ whiteSpace: 'pre-wrap' }}>
              {subject ? <strong>{render(subject)}</strong> : null}
              {subject ? '\n\n' : ''}
              {render(body)}
            </div>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={act.busy || !dirty || body.trim().length < 5}
            onClick={() =>
              void act.run(async () => {
                await api(`/admin/notifications/templates/${event.code}/${channel.code}`, { method: 'PUT', body: { subject: subject || undefined, body, isEnabled: enabled } });
                onSaved();
              }, 'حُفظ القالب — يحتاج مراجعة لغوية قبل اعتماده.')
            }
          >
            حفظ
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={act.busy || !template || dirty}
            onClick={() =>
              void act.run(async () => {
                setSent(await api(`/admin/notifications/templates/${event.code}/${channel.code}/test`, { method: 'POST' }));
              })
            }
          >
            أرسل تجربة لي
          </button>
        </div>
        {sent ? (
          <p className="small">
            {sent.status === 'sent' ? `وصلت إلى ${sent.recipient} — ${sent.deliveryRef}` : `لم تُرسل: ${sent.error}`}
          </p>
        ) : null}
        {template ? (
          <div className="stack stack--tight">
            <span className="small muted">
              {template.reviewedAt ? `راجعه لغوياً: ${template.reviewedBy} · ${when(template.reviewedAt)}` : 'لم يُراجَع لغوياً بعد.'}
            </span>
            {!template.reviewedAt ? (
              <div className="row">
                <TextArea label="اسم المراجِع" rows={1} value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
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
                  راجعتُ النص لغوياً
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
