import React, { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Link2, Pencil, Trash2, Upload, UserPlus, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { audit, callFn } from '../../lib/api';
import { chunk, downloadBlob, isEmail } from '../../lib/format';
import { autoMap, parseCsvText, parseFile, SAMPLE_CSV, validateRows } from '../../lib/tabular';
import { CertBadge, EmptyState, Field, Modal, Spinner, useToast } from '../../components/ui';

export default function RecipientsTab({ ctx }) {
  const { event, recipients, certs, reload } = ctx;
  const toast = useToast();
  const fileRef = useRef(null);
  const [table, setTable] = useState(null);
  const [map, setMap] = useState({ name: '', email: '' });
  const [fixCase, setFixCase] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', email: '' });
  const purged = event.status === 'purged';

  const certByRecipient = useMemo(() => {
    const m = {};
    certs.forEach((c) => { if (c.recipient_id) m[c.recipient_id] = c; });
    return m;
  }, [certs]);
  const existingEmails = useMemo(() => new Set(recipients.map((r) => (r.email || '').toLowerCase()).filter(Boolean)), [recipients]);
  const validated = useMemo(() => (table ? validateRows(table.rows, map, existingEmails, { fixCase }) : []), [table, map, existingEmails, fixCase]);
  const okRows = validated.filter((r) => r.status === 'ok');

  const loadTable = (t) => { setTable(t); setMap(autoMap(t.headers)); };
  const onFile = async (file) => {
    if (!file) return;
    try { loadTable(await parseFile(file)); if (table?.truncated) toast.error('Only the first 5,000 rows are used.'); } catch (e) { toast.error(e.message); }
  };
  const fromSheet = async () => {
    setBusy('sheet');
    try { const r = await callFn('fetch-sheet', { url: sheetUrl.trim() }); loadTable(parseCsvText(r.csv)); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const doImport = async () => {
    if (!map.name) return toast.error('Choose which column holds the participant name.');
    setBusy('import');
    try {
      for (const part of chunk(okRows, 500)) {
        const { error } = await supabase.from('recipients').insert(part.map((r) => ({ event_id: event.id, name: r.name, email: r.email, extra: r.extra })));
        if (error) throw error;
      }
      audit('recipients.imported', 'event', event.id, { count: okRows.length, skipped: validated.length - okRows.length });
      toast.ok(`${okRows.length} participants added`);
      setTable(null);
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const openAdd = () => { setForm({ name: '', email: '' }); setAdding(true); };
  const saveOne = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name) return;
    if (email && !isEmail(email)) return toast.error('That email address looks invalid.');
    setBusy('one');
    const res = editing
      ? await supabase.from('recipients').update({ name, email: email || null }).eq('id', editing.id)
      : await supabase.from('recipients').insert({ event_id: event.id, name, email: email || null, extra: {} });
    setBusy('');
    if (res.error) return toast.error(res.error.code === '23505' ? 'Another participant already has this email.' : res.error.message);
    audit(editing ? 'recipient.updated' : 'recipient.added', 'event', event.id, { name });
    setAdding(false);
    setEditing(null);
    reload();
  };
  const remove = async (r) => {
    if (!window.confirm(`Remove ${r.name}?`)) return;
    const { error } = await supabase.from('recipients').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    audit('recipient.removed', 'event', event.id, { name: r.name });
    reload();
  };

  const shown = recipients.filter((r) => !q || `${r.name} ${r.email || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
  const statusBadge = (s) => ({ ok: ['badge-ok', 'Will import'], error: ['badge-bad', 'Skipped'], duplicate: ['badge-warn', 'Duplicate'] }[s]);

  return (
    <div className="space-y-6">
      {purged ? (
        <div className="card p-5 text-sm text-slate2">This event’s participant data was purged. Create a new event to issue more certificates.</div>
      ) : (
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Add participants</h2>
              <p className="text-sm text-slate2">Upload a CSV or Excel file, import from a Google Sheet, or add people one by one.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-accent" onClick={() => fileRef.current.click()}><Upload className="h-4 w-4" />Upload CSV / Excel</button>
              <button className="btn btn-ghost" onClick={openAdd}><UserPlus className="h-4 w-4" />Add one</button>
              <button className="btn btn-ghost" onClick={() => downloadBlob(new Blob([SAMPLE_CSV], { type: 'text/csv' }), 'participants-sample.csv')}><Download className="h-4 w-4" />Sample file</button>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx" hidden onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
          <div className="mt-4 flex gap-2">
            <div className="relative flex-1"><Link2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input !pl-9" placeholder="Google Sheet link (sharing must be “Anyone with the link can view”)" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} /></div>
            <button className="btn btn-ghost" onClick={fromSheet} disabled={!sheetUrl.trim() || busy === 'sheet'}>{busy === 'sheet' ? <Spinner /> : <FileSpreadsheet className="h-4 w-4" />}Import sheet</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Any extra columns (rank, team, college…) are kept and can be used on the certificate as {'{{rank}}'}, {'{{team}}'} etc. Leave the email column empty if you only want to download certificates.</p>
        </div>
      )}

      {table && (
        <div className="card p-5">
          <h2 className="font-display text-base font-semibold">Check before importing</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Name column"><select className="input" value={map.name} onChange={(e) => setMap({ ...map, name: e.target.value })}><option value="">Select…</option>{table.headers.map((h) => <option key={h}>{h}</option>)}</select></Field>
            <Field label="Email column"><select className="input" value={map.email} onChange={(e) => setMap({ ...map, email: e.target.value })}><option value="">None (download only)</option>{table.headers.map((h) => <option key={h}>{h}</option>)}</select></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={fixCase} onChange={(e) => setFixCase(e.target.checked)} />Fix names typed in ALL CAPS or lowercase</label>
          </div>
          {map.name ? (
            <>
              <p className="mt-4 text-sm"><b>{okRows.length}</b> of {validated.length} rows will be imported{validated.length - okRows.length > 0 && <span className="text-slate2"> · {validated.length - okRows.length} skipped</span>}.</p>
              <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line">
                <table className="tbl"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Result</th></tr></thead>
                  <tbody>{validated.slice(0, 200).map((r) => { const [cls, label] = statusBadge(r.status); return (<tr key={r.index}><td className="text-slate-400">{r.index}</td><td>{r.name || '—'}</td><td>{r.email || '—'}</td><td><span className={`badge ${cls}`}>{label}</span>{r.note && <span className="ml-2 text-xs text-slate2">{r.note}</span>}</td></tr>); })}</tbody></table>
              </div>
              {validated.length > 200 && <p className="mt-1 text-xs text-slate-500">Showing the first 200 rows; all rows are checked.</p>}
            </>
          ) : <p className="mt-4 text-sm text-slate2">Choose the name column to see a preview.</p>}
          <div className="mt-4 flex gap-2">
            <button className="btn btn-accent" onClick={doImport} disabled={!map.name || okRows.length === 0 || busy === 'import'}>{busy === 'import' && <Spinner />}Import {okRows.length} participants</button>
            <button className="btn btn-ghost" onClick={() => setTable(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <h2 className="font-display text-base font-semibold">Participants ({recipients.length})</h2>
          <input className="input !w-60" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search participants" />
        </div>
        {recipients.length === 0 ? <EmptyState title="No participants yet">Upload a file above to get started.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Email</th><th>Extra columns</th><th>Certificate</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const c = certByRecipient[r.id];
                  return (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.name}</td>
                      <td>{r.email || <span className="text-slate-400">no email</span>}</td>
                      <td className="max-w-xs truncate text-xs text-slate2">{Object.entries(r.extra || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                      <td><CertBadge status={c?.status} /></td>
                      <td className="whitespace-nowrap text-right">
                        {!c && !purged && <>
                          <button className="btn btn-ghost btn-sm mr-1.5" onClick={() => { setEditing(r); setForm({ name: r.name, email: r.email || '' }); setAdding(true); }} aria-label={`Edit ${r.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                          <button className="btn btn-danger btn-sm" onClick={() => remove(r)} aria-label={`Remove ${r.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {recipients.length > shown.length && <p className="p-3 text-xs text-slate-500">Showing {shown.length} of {recipients.length}. Use search to find others.</p>}
          </div>
        )}
      </div>

      <Modal open={adding} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? 'Edit participant' : 'Add participant'}
        footer={<><button className="btn btn-ghost" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button><button className="btn btn-accent" form="one-form" disabled={busy === 'one'}>{busy === 'one' && <Spinner />}Save</button></>}>
        <form id="one-form" onSubmit={saveOne} className="space-y-4">
          <Field label="Full name"><input className="input" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" hint="Optional. Without an email the certificate can only be downloaded."><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </form>
      </Modal>
    </div>
  );
}
