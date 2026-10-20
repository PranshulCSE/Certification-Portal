import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Play } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { callFn, rpc, audit } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, PageLoader, Spinner, Stat, useToast } from '../components/ui';

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const o = await rpc('queue_overview');
      setOv(o);
      setForm({ daily_cap: o.daily_cap, batch_size: o.batch_size, sending_enabled: o.sending_enabled });
    } catch (e) { toast.error(e.message); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    const { error } = await supabase.from('app_settings').update({
      daily_cap: Number(form.daily_cap), batch_size: Number(form.batch_size), sending_enabled: !!form.sending_enabled, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setBusy('');
    if (error) return toast.error(error.message);
    audit('settings.updated', 'settings', '1', form);
    toast.ok('Settings saved');
    load();
  };

  const runWorker = async () => {
    setBusy('run');
    try { setResult(await callFn('process-queue')); load(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const testMail = async () => {
    setBusy('test');
    try {
      await callFn('send-test', { to: user.email, subject: 'Certificate portal: SMTP test', body: 'If you can read this, the portal mailbox (Google App Password) is working.' });
      toast.ok(`Test email sent to ${user.email}`);
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  if (!ov || !form) return <PageLoader />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const perMinute = Math.max(1, Number(form.batch_size));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Email settings</h1>
        <p className="text-sm text-slate2">Controls how fast the portal sends from the shared university mailbox.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting in queue" value={Number(ov.queued) + Number(ov.sending)} />
        <Stat label="Sent in last 24 hours" value={ov.sent_24h} sub={`of ${ov.daily_cap} daily cap`} />
        <Stat label="Failed / rejected" value={ov.failed} tone={Number(ov.failed) > 0 ? 'bad' : undefined} />
        <Stat label="Sending" value={ov.sending_enabled ? 'On' : 'Paused'} tone={ov.sending_enabled ? 'ok' : 'bad'} />
      </div>

      <form onSubmit={save} className="card max-w-2xl space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Daily cap (emails per rolling 24 hours)" hint="Google Workspace allows about 2,000 per mailbox per day. Keep this below that. When the cap is reached the queue pauses and resumes by itself."><input className="input" type="number" min="1" max="100000" value={form.daily_cap} onChange={set('daily_cap')} /></Field>
          <Field label="Emails per minute" hint={`The worker runs every minute and sends up to ${perMinute} mails per run.`}><input className="input" type="number" min="1" max="200" value={form.batch_size} onChange={set('batch_size')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!form.sending_enabled} onChange={set('sending_enabled')} />Sending enabled (untick to pause all emails)</label>
        <button className="btn btn-primary" disabled={busy === 'save'}>{busy === 'save' && <Spinner />}Save settings</button>
      </form>

      <div className="card max-w-2xl space-y-3 p-5">
        <h2 className="font-display text-base font-semibold">Mailbox check</h2>
        <p className="text-sm text-slate2">Send a test email to <b>{user.email}</b> to confirm the Google App Password and Edge Functions are set up correctly.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={testMail} disabled={busy === 'test'}>{busy === 'test' ? <Spinner /> : <Mail className="h-4 w-4" />}Send test email to me</button>
          <button className="btn btn-ghost" onClick={runWorker} disabled={busy === 'run'}>{busy === 'run' ? <Spinner /> : <Play className="h-4 w-4" />}Run email worker now</button>
        </div>
        {result && <pre className="overflow-x-auto rounded-lg bg-mist p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
      </div>
    </div>
  );
}
