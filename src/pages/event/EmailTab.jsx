import React, { useState } from 'react';
import { Mail, Save } from 'lucide-react';
import { supabase, verifyUrl } from '../../lib/supabase';
import { audit, callFn } from '../../lib/api';
import { buildValues, BASE_TOKENS, EMAIL_TOKENS, fillTemplate, normKey, safeFileName, blobToBase64 } from '../../lib/format';
import { DEFAULT_EMAIL, SAMPLE_VALUES } from '../../lib/defaults';
import { loadTemplateAssets, renderPdfBlob } from '../../lib/render';
import { useAuth } from '../../lib/auth';
import { Field, Spinner, useToast } from '../../components/ui';

export default function EmailTab({ ctx }) {
  const { event, template, recipients, reload, ownerName } = ctx;
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ subject: event.email_subject, body: event.email_body, sender: event.sender_display_name, reply: event.reply_to });
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const bodyRef = React.useRef(null);

  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setDirty(true); };
  const extra = [...new Set(recipients.slice(0, 200).flatMap((r) => Object.keys(r.extra || {}).map(normKey)))].filter((k) => !BASE_TOKENS.includes(k));
  const tokens = [...EMAIL_TOKENS, ...extra];
  const sample = recipients[0];
  const values = buildValues({ name: sample?.name || SAMPLE_VALUES.name, extra: sample?.extra }, event, { code: SAMPLE_VALUES.code, issuer: ownerName, verify_url: verifyUrl(SAMPLE_VALUES.code) });

  const insert = (tok) => {
    const el = bodyRef.current;
    const t = `{{${tok}}}`;
    const s = el.selectionStart ?? f.body.length;
    const e = el.selectionEnd ?? s;
    setF((x) => ({ ...x, body: x.body.slice(0, s) + t + x.body.slice(e) }));
    setDirty(true);
    setTimeout(() => { el.focus(); el.setSelectionRange(s + t.length, s + t.length); }, 0);
  };

  const save = async () => {
    setBusy('save');
    const { error } = await supabase.from('events').update({ email_subject: f.subject, email_body: f.body, sender_display_name: f.sender.trim(), reply_to: f.reply.trim() }).eq('id', event.id);
    setBusy('');
    if (error) return toast.error(error.message);
    audit('email.template_saved', 'event', event.id);
    setDirty(false);
    toast.ok('Email settings saved. They apply to emails queued from now on.');
    reload();
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      let attachment = {};
      if (template) {
        const tpl = { ...template, config: template.config };
        const assets = await loadTemplateAssets(tpl);
        const blob = await renderPdfBlob(tpl, assets, values, verifyUrl(SAMPLE_VALUES.code));
        attachment = { pdf_base64: await blobToBase64(blob), filename: `${safeFileName(values.name)}_certificate.pdf` };
      }
      await callFn('send-test', { to: user.email, subject: fillTemplate(f.subject, values), body: fillTemplate(f.body, values), from_name: f.sender, reply_to: f.reply, ...attachment });
      toast.ok(`Test email sent to ${user.email}`);
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-4 p-5">
        <h2 className="font-display text-base font-semibold">Email template</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name" hint="Name participants see. The address is the portal mailbox."><input className="input" value={f.sender} onChange={set('sender')} /></Field>
          <Field label="Reply-to" hint="Where replies go"><input className="input" type="email" value={f.reply} onChange={set('reply')} /></Field>
        </div>
        <Field label="Subject"><input className="input" value={f.subject} onChange={set('subject')} /></Field>
        <Field label="Message">
          <textarea ref={bodyRef} className="input min-h-[260px] font-mono text-[13px]" value={f.body} onChange={set('body')} />
        </Field>
        <div>
          <p className="label">Insert a placeholder</p>
          <div className="flex flex-wrap gap-1">{tokens.map((t) => <button type="button" key={t} className="chip" onClick={() => insert(t)}>{`{{${t}}}`}</button>)}</div>
        </div>
        <p className="text-xs text-slate-500">The certificate PDF is attached automatically. Keep {'{{verify_url}}'} in the message so people can verify it.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-accent" onClick={save} disabled={!dirty || busy === 'save'}>{busy === 'save' ? <Spinner /> : <Save className="h-4 w-4" />}Save</button>
          <button className="btn btn-ghost" onClick={() => { setF((x) => ({ ...x, subject: DEFAULT_EMAIL.subject, body: DEFAULT_EMAIL.body })); setDirty(true); }}>Reset to default text</button>
          <button className="btn btn-ghost" onClick={sendTest} disabled={busy === 'test'}>{busy === 'test' ? <Spinner /> : <Mail className="h-4 w-4" />}Send test to me</button>
        </div>
        <p className="text-xs text-slate-500">The test email goes to <b>{user.email}</b> with a sample certificate attached, using the last saved template design.</p>
      </div>

      <div className="card p-5">
        <h2 className="font-display text-base font-semibold">Preview</h2>
        <p className="mt-1 text-xs text-slate-500">Shown for {sample ? sample.name : 'a sample participant'}.</p>
        <div className="mt-3 rounded-lg border border-line bg-mist p-4 text-sm">
          <p className="text-xs text-slate2">From: {f.sender || 'Certificate Portal'}</p>
          <p className="text-xs text-slate2">Subject: <b className="text-ink">{fillTemplate(f.subject, values)}</b></p>
          <hr className="my-3 border-line" />
          <pre className="whitespace-pre-wrap break-words font-sans">{fillTemplate(f.body, values)}</pre>
          <p className="mt-3 inline-block rounded border border-line bg-white px-2 py-1 text-xs text-slate2">📎 {safeFileName(values.name)}_certificate.pdf</p>
        </div>
      </div>
    </div>
  );
}
