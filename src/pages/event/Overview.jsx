import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { rpc, audit } from '../../lib/api';
import { Field, Spinner, Stat, useToast } from '../../components/ui';

export default function Overview({ ctx }) {
  const { event, reload } = ctx;
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({ name: event.name, organizer: event.organizer, event_date: event.event_date || '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { rpc('event_stats', { p_event: event.id }).then(setStats).catch((e) => toast.error(e.message)); }, [event.id, ctx.certs.length, ctx.jobs.length, toast]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('events').update({ name: form.name.trim(), organizer: form.organizer.trim(), event_date: form.event_date || null }).eq('id', event.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    audit('event.updated', 'event', event.id, form);
    toast.ok('Event details saved');
    reload();
  };

  const jobs = stats?.jobs || {};
  const pending = (jobs.queued || 0) + (jobs.sending || 0);
  const failed = (jobs.failed || 0) + (jobs.bounced || 0);
  const days = stats?.views_by_day || [];
  const max = Math.max(1, ...days.map((d) => d.n));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Participants" value={stats ? stats.recipients : '…'} />
        <Stat label="Certificates issued" value={stats ? stats.certificates - stats.revoked : '…'} sub={stats?.revoked ? `${stats.revoked} revoked` : undefined} />
        <Stat label="Emails sent" value={stats ? jobs.sent || 0 : '…'} sub={pending ? `${pending} still in queue` : undefined} />
        <Stat label="Failed or rejected" value={stats ? failed : '…'} tone={failed ? 'bad' : undefined} />
        <Stat label="Verify page views" value={stats ? stats.views_total : '…'} sub={stats ? `${stats.unique_viewed} different certificates` : undefined} />
      </div>

      <div className="card p-5">
        <h2 className="font-display text-base font-semibold">Verify page views, last 14 days</h2>
        {days.length === 0 ? (
          <p className="mt-3 text-sm text-slate2">No one has opened a verify link yet. Views appear here when people scan the QR code or follow the link in the email.</p>
        ) : (
          <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Bar chart of verify page views per day">
            {days.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.n}`}>
                <span className="text-[10px] text-slate2">{d.n}</span>
                <div className="w-full rounded-t bg-saffron-500" style={{ height: `${Math.max(6, (d.n / max) * 100)}%` }} />
                <span className="text-[10px] text-slate-500">{String(d.day).slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={save} className="card max-w-2xl space-y-4 p-5">
        <h2 className="font-display text-base font-semibold">Event details</h2>
        <Field label="Event name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organized by"><input className="input" value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} /></Field>
          <Field label="Event date"><input className="input" type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500">Certificates that were already generated keep the event name and date they were issued with. Changes apply to certificates generated from now on.</p>
        <button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}Save details</button>
      </form>
    </div>
  );
}
