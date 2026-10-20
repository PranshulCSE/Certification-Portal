import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, UserCheck, UserX, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { callFn, fetchAll, audit } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { copyText, EmptyState, Field, Modal, PageLoader, Spinner, useToast } from '../components/ui';

export default function Issuers() {
  const { user } = useAuth();
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [counts, setCounts] = useState({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', department: '' });
  const [creds, setCreds] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setPeople(data);
      const ev = await fetchAll(() => supabase.from('events').select('id, owner_id').order('created_at'));
      const c = {};
      ev.forEach((e) => { c[e.owner_id] = (c[e.owner_id] || 0) + 1; });
      setCounts(c);
    } catch (e) {
      toast.error(e.message);
      setPeople([]);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await callFn('admin-users', { action: 'create', ...form });
      setOpen(false);
      setCreds({ ...res, full_name: form.full_name });
      setForm({ full_name: '', email: '', department: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p) => {
    const next = p.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`Suspend ${p.full_name}? They will lose access immediately and queued emails from their events will pause.`)) return;
    const { error } = await supabase.from('profiles').update({ status: next }).eq('id', p.id);
    if (error) return toast.error(error.message);
    audit(next === 'suspended' ? 'issuer.suspended' : 'issuer.activated', 'profile', p.id, { name: p.full_name });
    toast.ok(next === 'suspended' ? `${p.full_name} suspended` : `${p.full_name} re-activated`);
    load();
  };

  const reset = async (p) => {
    if (!window.confirm(`Generate a new temporary password for ${p.full_name}?`)) return;
    try {
      const res = await callFn('admin-users', { action: 'reset_password', user_id: p.id });
      setCreds({ ...res, full_name: p.full_name });
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!people) return <PageLoader />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Issuers</h1>
          <p className="text-sm text-slate2">Event coordinators who can create and send certificates. Only you can add them.</p>
        </div>
        <button className="btn btn-accent" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add issuer</button>
      </div>

      <div className="card overflow-x-auto">
        {people.length === 0 ? <EmptyState title="No issuers yet" /> : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th className="text-right">Events</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.full_name}</td>
                  <td>{p.email}</td>
                  <td>{p.department || '—'}</td>
                  <td>{p.role === 'admin' ? <span className="badge badge-info">Admin</span> : 'Issuer'}</td>
                  <td className="text-right">{counts[p.id] || 0}</td>
                  <td>{p.status === 'active' ? <span className="badge badge-ok">Active</span> : <span className="badge badge-bad">Suspended</span>}</td>
                  <td className="text-xs text-slate-500">{formatDateTime(p.created_at)}</td>
                  <td className="whitespace-nowrap text-right">
                    {p.id !== user.id && (
                      <>
                        <button className="btn btn-ghost btn-sm mr-1.5" onClick={() => reset(p)} title="New temporary password"><KeyRound className="h-3.5 w-3.5" />Reset password</button>
                        <button className={`btn btn-sm ${p.status === 'active' ? 'btn-danger' : 'btn-ghost'}`} onClick={() => toggle(p)}>
                          {p.status === 'active' ? <><UserX className="h-3.5 w-3.5" />Suspend</> : <><UserCheck className="h-3.5 w-3.5" />Activate</>}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add issuer"
        footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-accent" form="new-issuer" disabled={busy}>{busy && <Spinner />}Create issuer</button></>}>
        <form id="new-issuer" onSubmit={create} className="space-y-4">
          <Field label="Full name" hint="Shown on the verify page as the issuer of every certificate they create. They cannot change it."><input className="input" required value={form.full_name} onChange={set('full_name')} /></Field>
          <Field label="Email"><input className="input" type="email" required value={form.email} onChange={set('email')} /></Field>
          <Field label="Department / club"><input className="input" placeholder="e.g. SCSE, Training & Placement Cell" value={form.department} onChange={set('department')} /></Field>
          <p className="text-xs text-slate-500">A temporary password is generated, emailed to them from the portal mailbox, and shown to you once.</p>
        </form>
      </Modal>

      <Modal open={!!creds} onClose={() => setCreds(null)} title="Login details" footer={<button className="btn btn-primary" onClick={() => setCreds(null)}>Done</button>}>
        {creds && (
          <div className="space-y-3 text-sm">
            <p>Share these with <b>{creds.full_name}</b>. They must set their own password at first login. This is the only time the password is shown.</p>
            <div className="rounded-lg border border-line bg-mist p-3 font-mono text-sm">
              <p>Email: {creds.email}</p>
              <p>Temporary password: <b>{creds.temp_password}</b></p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={async () => toast[(await copyText(`Email: ${creds.email}\nTemporary password: ${creds.temp_password}`)) ? 'ok' : 'error']('Copied')}><Copy className="h-3.5 w-3.5" />Copy</button>
            {creds.email_sent === true && <p className="text-ok">Credentials were also emailed to them.</p>}
            {creds.email_sent === false && <p className="text-amber-700">Email could not be sent ({creds.email_error || 'SMTP error'}). Share the details manually.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
