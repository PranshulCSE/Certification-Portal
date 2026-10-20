import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAll, rpc, audit } from '../lib/api';
import { useAuth } from '../lib/auth';
import { defaultConfig, DEFAULT_SIZE, DEFAULT_EMAIL } from '../lib/defaults';
import { formatDate } from '../lib/format';
import { EmptyState, Field, Modal, PageLoader, Spinner, useToast } from '../components/ui';

export default function Events() {
  const { user, profile, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [events, setEvents] = useState(null);
  const [stats, setStats] = useState({});
  const [owners, setOwners] = useState({});
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', organizer: '', event_date: '', sender_display_name: '', reply_to: '' });

  const load = useCallback(async () => {
    try {
      const [ev, ov] = await Promise.all([
        fetchAll(() => supabase.from('events').select('*').order('created_at', { ascending: false })),
        rpc('events_overview'),
      ]);
      setEvents(ev);
      setStats(Object.fromEntries((ov || []).map((r) => [r.event_id, r])));
      if (isAdmin) {
        const { data } = await supabase.from('profiles').select('id, full_name');
        setOwners(Object.fromEntries((data || []).map((p) => [p.id, p.full_name])));
      }
    } catch (e) {
      toast.error(e.message);
      setEvents([]);
    }
  }, [isAdmin, toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ name: '', organizer: '', event_date: '', sender_display_name: profile?.full_name || '', reply_to: user?.email || '' });
    setOpen(true);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('events')
        .insert({
          owner_id: user.id,
          name: form.name.trim(),
          organizer: form.organizer.trim(),
          event_date: form.event_date || null,
          sender_display_name: form.sender_display_name.trim(),
          reply_to: form.reply_to.trim(),
          email_subject: DEFAULT_EMAIL.subject,
          email_body: DEFAULT_EMAIL.body,
        })
        .select()
        .single();
      if (error) throw error;
      const t = await supabase.from('event_templates').insert({ event_id: data.id, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, config: defaultConfig() });
      if (t.error) throw t.error;
      audit('event.created', 'event', data.id, { name: data.name });
      navigate(`/events/${data.id}?tab=template`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!events) return <PageLoader />;
  const shown = events.filter((e) => ownerFilter === 'all' || e.owner_id === ownerFilter);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Events</h1>
          <p className="text-sm text-slate2">Each event has its own template, participant list and email.</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select className="input !w-auto" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} aria-label="Filter by issuer">
              <option value="all">All issuers</option>
              {Object.entries(owners).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          )}
          <button className="btn btn-accent" onClick={openCreate}><Plus className="h-4 w-4" />New event</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {shown.length === 0 ? (
          <EmptyState title="No events yet" action={<button className="btn btn-accent" onClick={openCreate}><Plus className="h-4 w-4" />Create your first event</button>}>
            Create an event such as “SIH Participation”, set up its certificate, then upload the participant list.
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead><tr><th>Event</th>{isAdmin && <th>Issuer</th>}<th>Date</th><th className="text-right">Participants</th><th className="text-right">Certificates</th><th className="text-right">Emails sent</th><th className="text-right">Needs attention</th></tr></thead>
            <tbody>
              {shown.map((ev) => {
                const s = stats[ev.id] || {};
                return (
                  <tr key={ev.id} className="cursor-pointer hover:bg-mist" onClick={() => navigate(`/events/${ev.id}`)}>
                    <td><p className="font-semibold">{ev.name}</p><p className="text-xs text-slate-500">{ev.organizer}{ev.status === 'purged' && ' · data purged'}</p></td>
                    {isAdmin && <td>{owners[ev.owner_id] || '—'}</td>}
                    <td>{formatDate(ev.event_date) || '—'}</td>
                    <td className="text-right">{s.recipients ?? 0}</td>
                    <td className="text-right">{s.certificates ?? 0}</td>
                    <td className="text-right">{s.sent ?? 0}</td>
                    <td className="text-right">{Number(s.failed) > 0 ? <span className="badge badge-bad">{s.failed} failed</span> : Number(s.queued) > 0 ? <span className="badge badge-info">{s.queued} in queue</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New event"
        footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-accent" form="new-event" disabled={busy}>{busy && <Spinner />}Create event</button></>}>
        <form id="new-event" onSubmit={create} className="space-y-4">
          <Field label="Event name" hint="Shown on certificates and the verify page, e.g. Smart India Hackathon 2026 – Participation"><input className="input" required autoFocus value={form.name} onChange={set('name')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organized by"><input className="input" placeholder="e.g. SCSE, Geeta University" value={form.organizer} onChange={set('organizer')} /></Field>
            <Field label="Event date"><input className="input" type="date" value={form.event_date} onChange={set('event_date')} /></Field>
            <Field label="Email sender name" hint="Display name participants see"><input className="input" value={form.sender_display_name} onChange={set('sender_display_name')} /></Field>
            <Field label="Reply-to email" hint="Replies go here"><input className="input" type="email" value={form.reply_to} onChange={set('reply_to')} /></Field>
          </div>
        </form>
      </Modal>
    </div>
  );
}
