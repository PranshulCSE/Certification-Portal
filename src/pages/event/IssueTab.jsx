import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Archive, Ban, Copy, Download, FileCheck2, Play, RefreshCw, RotateCcw, Send, Undo2, XCircle } from 'lucide-react';
import { supabase, verifyUrl } from '../../lib/supabase';
import { audit, callFn, rpc } from '../../lib/api';
import { generateCode } from '../../lib/code';
import { buildValues, chunk, downloadBlob, fillTemplate, formatDate, formatDateTime, runPool, safeFileName } from '../../lib/format';
import { loadTemplateAssets, renderPdfBlob } from '../../lib/render';
import { CertBadge, copyText, EmptyState, Field, JobBadge, Modal, Spinner, Stat, useToast } from '../../components/ui';

export default function IssueTab({ ctx }) {
  const { event, template, recipients, certs, jobs, reload } = ctx;
  const toast = useToast();
  const [limits, setLimits] = useState(null);
  const [progress, setProgress] = useState(null); // {label, done, total}
  const [busy, setBusy] = useState('');
  const [when, setWhen] = useState('now');
  const [at, setAt] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [revokeFor, setRevokeFor] = useState(null);
  const [reason, setReason] = useState('');
  const purged = event.status === 'purged';

  useEffect(() => { rpc('get_send_limits').then(setLimits).catch(() => {}); }, []);

  const recipientById = useMemo(() => Object.fromEntries(recipients.map((r) => [r.id, r])), [recipients]);
  const certByRecipient = useMemo(() => { const m = {}; certs.forEach((c) => { if (c.recipient_id) m[c.recipient_id] = c; }); return m; }, [certs]);
  const jobByCert = useMemo(() => { const m = {}; jobs.forEach((j) => { m[j.certificate_id] = j; }); return m; }, [jobs]);

  const pendingRecipients = recipients.filter((r) => !certByRecipient[r.id]);
  const incomplete = certs.filter((c) => c.status === 'issued' && !c.pdf_ready);
  const ready = certs.filter((c) => c.status === 'issued' && c.pdf_ready);
  const toQueue = ready.filter((c) => {
    const r = recipientById[c.recipient_id];
    const j = jobByCert[c.id];
    return r?.email && (!j || j.status === 'cancelled');
  });
  const inQueue = jobs.filter((j) => j.status === 'queued' || j.status === 'sending').length;
  const failedJobs = jobs.filter((j) => j.status === 'failed').length;
  const sentCount = jobs.filter((j) => j.status === 'sent').length;

  // keep the status table fresh while mail is going out
  useEffect(() => {
    if (!inQueue) return undefined;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [inQueue, reload]);

  const valuesFor = (cert, recipient) => {
    const ev = { name: cert.event_name, organizer: cert.organizer, event_date: cert.event_date };
    const v = buildValues({ name: cert.recipient_name, extra: cert.fields_snapshot || recipient?.extra }, ev, { code: cert.verification_code, issuer: cert.issuer_name, verify_url: verifyUrl(cert.verification_code) });
    v.issue_date = formatDate(cert.issue_date);
    return v;
  };

  // ---------- 1. generate ----------
  const generate = async () => {
    setBusy('generate');
    let failures = 0;
    try {
      const assets = await loadTemplateAssets(template);
      const total = incomplete.length + pendingRecipients.length;
      let done = 0;
      setProgress({ label: 'Generating certificates', done, total });

      const renderUpload = async (cert) => {
        try {
          const blob = await renderPdfBlob(template, assets, valuesFor(cert, recipientById[cert.recipient_id]), verifyUrl(cert.verification_code));
          const { error } = await supabase.storage.from('certificates').upload(cert.pdf_path, blob, { upsert: true, contentType: 'application/pdf' });
          if (error) throw error;
          return cert.id;
        } catch (e) {
          failures += 1;
          console.error(e);
          return null;
        } finally {
          done += 1;
          setProgress({ label: 'Generating certificates', done, total });
        }
      };
      const finish = async (list) => {
        const ids = [];
        await runPool(list, 3, async (c) => { const id = await renderUpload(c); if (id) ids.push(id); });
        for (const part of chunk(ids, 200)) await rpc('mark_pdfs_ready', { p_ids: part });
      };

      if (incomplete.length) await finish(incomplete);

      for (const part of chunk(pendingRecipients, 25)) {
        let inserted = null;
        for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
          const rows = part.map((r) => ({ id: crypto.randomUUID(), event_id: event.id, recipient_id: r.id, verification_code: generateCode(), recipient_name: r.name, fields_snapshot: r.extra || {} }));
          const { data, error } = await supabase.from('certificates').insert(rows).select();
          if (!error) inserted = data;
          else if (error.code !== '23505') throw error; // 23505 = code collision, extremely rare: retry with new codes
        }
        if (!inserted) throw new Error('Could not create unique certificate codes. Please try again.');
        await finish(inserted);
      }
      audit('certificates.generated', 'event', event.id, { count: total - failures, failed: failures });
      toast[failures ? 'error' : 'ok'](failures ? `${total - failures} generated, ${failures} failed. Click Generate again to retry the failed ones.` : `${total} certificates generated`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setProgress(null);
      setBusy('');
      reload();
    }
  };

  // ---------- 2. email ----------
  const queueEmails = async () => {
    if (when === 'later' && !at) return toast.error('Pick a date and time.');
    setBusy('queue');
    try {
      const scheduled = when === 'later' ? new Date(at).toISOString() : new Date().toISOString();
      const rows = toQueue.map((c) => {
        const r = recipientById[c.recipient_id];
        const v = valuesFor(c, r);
        return {
          event_id: event.id, certificate_id: c.id, to_email: r.email, to_name: r.name,
          from_name: event.sender_display_name || null, reply_to: event.reply_to || null,
          subject: fillTemplate(event.email_subject, v), body: fillTemplate(event.email_body, v),
          attachment_name: `${safeFileName(r.name)}_certificate.pdf`, scheduled_at: scheduled,
        };
      });
      for (const part of chunk(rows, 200)) {
        const { error } = await supabase.from('email_jobs').insert(part);
        if (error) throw error;
      }
      audit('emails.queued', 'event', event.id, { count: rows.length, scheduled_at: scheduled });
      toast.ok(when === 'later' ? `${rows.length} emails scheduled` : `${rows.length} emails queued. They go out automatically.`);
      if (when === 'now') callFn('process-queue').catch(() => {});
      await reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const runWorker = async () => {
    setBusy('run');
    try { const r = await callFn('process-queue'); toast.ok(r.message || `Sent ${r.sent ?? 0}, failed ${r.failed ?? 0}`); await reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const retryFailed = async () => { try { const n = await rpc('retry_failed_jobs', { p_event: event.id }); toast.ok(`${n} emails re-queued`); reload(); } catch (e) { toast.error(e.message); } };
  const cancelQueued = async () => { if (!window.confirm('Cancel all emails that are still waiting?')) return; try { const n = await rpc('cancel_queued_jobs', { p_event: event.id }); toast.ok(`${n} emails cancelled`); reload(); } catch (e) { toast.error(e.message); } };

  // ---------- downloads ----------
  const signed = async (paths, seconds = 600) => {
    const { data, error } = await supabase.storage.from('certificates').createSignedUrls(paths, seconds);
    if (error) throw error;
    return data;
  };
  const downloadOne = async (c) => {
    try {
      const [s] = await signed([c.pdf_path], 120);
      const blob = await (await fetch(s.signedUrl)).blob();
      downloadBlob(blob, `${safeFileName(c.recipient_name)}_certificate.pdf`);
    } catch (e) { toast.error(e.message); }
  };
  const downloadZip = async () => {
    setBusy('zip');
    try {
      const list = ready;
      const zip = new JSZip();
      let done = 0;
      setProgress({ label: 'Preparing ZIP', done, total: list.length });
      for (const part of chunk(list, 100)) {
        const urls = await signed(part.map((c) => c.pdf_path));
        await runPool(part, 5, async (c, i) => {
          const res = await fetch(urls[i].signedUrl);
          zip.file(`${safeFileName(c.recipient_name)}_${c.verification_code}.pdf`, await res.blob());
          done += 1;
          setProgress({ label: 'Preparing ZIP', done, total: list.length });
        });
      }
      downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `${safeFileName(event.name)}_certificates.zip`);
      audit('certificates.zip_downloaded', 'event', event.id, { count: list.length });
    } catch (e) { toast.error(e.message); } finally { setProgress(null); setBusy(''); }
  };

  // ---------- row actions ----------
  const doRevoke = async () => {
    try { await rpc('revoke_certificate', { p_id: revokeFor.id, p_reason: reason }); toast.ok('Certificate revoked. The verify page now shows it as revoked.'); setRevokeFor(null); setReason(''); reload(); } catch (e) { toast.error(e.message); }
  };
  const reinstate = async (c) => { try { await rpc('reinstate_certificate', { p_id: c.id }); toast.ok('Certificate reinstated'); reload(); } catch (e) { toast.error(e.message); } };
  const reissue = async (c) => {
    if (!window.confirm(`Revoke the current certificate for ${c.recipient_name} and prepare a new one? Fix the name or email in the Participants tab first if needed, then click “Generate”.`)) return;
    try { await rpc('reissue_certificate', { p_id: c.id, p_reason: 'Reissued' }); toast.ok('Old certificate revoked. Click “Generate certificates” to create the new one.'); reload(); } catch (e) { toast.error(e.message); }
  };
  const retryJob = async (job, r) => {
    let email = null;
    if (job.status !== 'sent') {
      const v = window.prompt('Send to this email address (edit if it was wrong):', job.to_email);
      if (v === null) return;
      email = v.trim() === job.to_email ? null : v.trim();
    } else if (!window.confirm(`Send this certificate to ${r?.email || job.to_email} again?`)) return;
    try { await rpc('retry_job', { p_id: job.id, p_email: email }); toast.ok('Queued'); reload(); } catch (e) { toast.error(e.message); }
  };

  // ---------- table rows ----------
  const rows = useMemo(() => {
    const out = recipients.map((r) => ({ key: r.id, name: r.name, email: r.email, recipient: r, cert: certByRecipient[r.id] }));
    certs.filter((c) => !c.recipient_id).forEach((c) => out.push({ key: c.id, name: c.recipient_name, email: null, recipient: null, cert: c }));
    return out;
  }, [recipients, certs, certByRecipient]);

  const shown = rows.filter((row) => {
    if (q && !`${row.name} ${row.email || ''} ${row.cert?.verification_code || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    const j = row.cert ? jobByCert[row.cert.id] : null;
    switch (filter) {
      case 'pending': return !row.cert;
      case 'issued': return row.cert?.status === 'issued';
      case 'revoked': return row.cert?.status === 'revoked';
      case 'unsent': return row.cert?.status === 'issued' && (!j || j.status === 'cancelled');
      case 'sent': return j?.status === 'sent';
      case 'failed': return j && (j.status === 'failed' || j.status === 'bounced');
      default: return true;
    }
  }).slice(0, 200);

  const eta = limits && toQueue.length ? Math.ceil(toQueue.length / limits.batch_size) : 0;
  const days = limits ? Math.ceil(toQueue.length / limits.daily_cap) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting for a certificate" value={pendingRecipients.length + incomplete.length} />
        <Stat label="Ready to email" value={toQueue.length} />
        <Stat label="In email queue" value={inQueue} />
        <Stat label="Sent" value={sentCount} sub={failedJobs ? `${failedJobs} failed` : undefined} tone={failedJobs ? 'bad' : undefined} />
      </div>

      {progress && (
        <div className="card p-4" role="status" aria-live="polite">
          <p className="text-sm font-semibold">{progress.label}… {progress.done} / {progress.total}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist"><div className="h-full bg-saffron-600 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <p className="mt-2 text-xs text-slate-500">Keep this tab open until generation finishes. If it closes, come back and click Generate again; it continues where it stopped.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-3 p-5">
          <p className="text-xs font-bold text-saffron-700">Step 1</p>
          <h2 className="font-display text-base font-semibold">Generate certificates</h2>
          <p className="text-sm text-slate2">Creates a PDF with a unique verification code and QR for each participant.</p>
          <button className="btn btn-accent w-full" onClick={generate} disabled={!!busy || purged || pendingRecipients.length + incomplete.length === 0}>{busy === 'generate' ? <Spinner /> : <FileCheck2 className="h-4 w-4" />}Generate {pendingRecipients.length + incomplete.length || ''} certificates</button>
          {recipients.length === 0 && !purged && <p className="text-xs text-slate-500">Add participants first.</p>}
        </div>

        <div className="card space-y-3 p-5">
          <p className="text-xs font-bold text-saffron-700">Step 2</p>
          <h2 className="font-display text-base font-semibold">Email them</h2>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} />Send now</label>
            <label className="flex items-center gap-2"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} />Schedule for later</label>
            {when === 'later' && <input type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Send at" />}
          </div>
          <button className="btn btn-primary w-full" onClick={queueEmails} disabled={!!busy || toQueue.length === 0}>{busy === 'queue' ? <Spinner /> : <Send className="h-4 w-4" />}Queue {toQueue.length || ''} emails</button>
          {limits && toQueue.length > 0 && <p className="text-xs text-slate-500">Sends about {limits.batch_size} per minute (cap {limits.daily_cap}/day). Roughly {eta} min{days > 1 ? `, spread over ${days} days` : ''}.{!limits.sending_enabled && ' Sending is currently paused by the admin.'}</p>}
        </div>

        <div className="card space-y-3 p-5">
          <p className="text-xs font-bold text-saffron-700">Step 3</p>
          <h2 className="font-display text-base font-semibold">Download &amp; manage</h2>
          <button className="btn btn-ghost w-full" onClick={downloadZip} disabled={!!busy || ready.length === 0}>{busy === 'zip' ? <Spinner /> : <Archive className="h-4 w-4" />}Download all as ZIP ({ready.length})</button>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost btn-sm" onClick={runWorker} disabled={busy === 'run'} title="Send the next batch now instead of waiting for the minute timer">{busy === 'run' ? <Spinner /> : <Play className="h-3.5 w-3.5" />}Send next batch</button>
            <button className="btn btn-ghost btn-sm" onClick={reload}><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
            <button className="btn btn-ghost btn-sm" onClick={retryFailed} disabled={!failedJobs}><RotateCcw className="h-3.5 w-3.5" />Retry failed</button>
            <button className="btn btn-danger btn-sm" onClick={cancelQueued} disabled={!jobs.some((j) => j.status === 'queued')}><XCircle className="h-3.5 w-3.5" />Cancel queued</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <h2 className="font-display text-base font-semibold">Certificates &amp; email status</h2>
          <div className="flex gap-2">
            <select className="input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
              <option value="all">All</option><option value="pending">No certificate yet</option><option value="issued">Issued</option><option value="revoked">Revoked</option><option value="unsent">Not emailed</option><option value="sent">Emailed</option><option value="failed">Email failed</option>
            </select>
            <input className="input !w-56" placeholder="Search name, email, ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
        </div>
        {rows.length === 0 ? <EmptyState title="Nothing to show yet">Add participants, then generate their certificates.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Participant</th><th>Certificate</th><th>Email</th><th /></tr></thead>
              <tbody>
                {shown.map((row) => {
                  const c = row.cert;
                  const j = c ? jobByCert[c.id] : null;
                  return (
                    <tr key={row.key}>
                      <td><p className="font-semibold">{row.name}</p><p className="text-xs text-slate-500">{row.email || 'no email'}</p></td>
                      <td><CertBadge status={c?.status} />{c && <p className="mt-0.5 font-mono text-xs text-slate2">{c.verification_code}</p>}{c && !c.pdf_ready && c.status === 'issued' && <p className="text-xs text-amber-700">PDF not finished</p>}</td>
                      <td>{c ? <><JobBadge status={j?.status} />{j?.sent_at && <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(j.sent_at)}</p>}{j?.status === 'queued' && new Date(j.scheduled_at) > new Date() && <p className="mt-0.5 text-xs text-slate-500">at {formatDateTime(j.scheduled_at)}</p>}{j?.last_error && (j.status === 'failed' || j.status === 'bounced' || j.status === 'queued') && <p className="mt-0.5 max-w-[240px] truncate text-xs text-bad" title={j.last_error}>{j.last_error}</p>}</> : '—'}</td>
                      <td className="whitespace-nowrap text-right">
                        {c && c.status === 'issued' && c.pdf_ready && <button className="btn btn-ghost btn-sm mr-1" onClick={() => downloadOne(c)} title="Download PDF"><Download className="h-3.5 w-3.5" /></button>}
                        {c && <button className="btn btn-ghost btn-sm mr-1" onClick={async () => toast[(await copyText(verifyUrl(c.verification_code))) ? 'ok' : 'error']('Verify link copied')} title="Copy verify link"><Copy className="h-3.5 w-3.5" /></button>}
                        {j && ['failed', 'bounced'].includes(j.status) && <button className="btn btn-ghost btn-sm mr-1" onClick={() => retryJob(j, row.recipient)}><RotateCcw className="h-3.5 w-3.5" />Retry</button>}
                        {j && j.status === 'sent' && c.status === 'issued' && <button className="btn btn-ghost btn-sm mr-1" onClick={() => retryJob(j, row.recipient)}><Send className="h-3.5 w-3.5" />Resend</button>}
                        {c?.status === 'issued' && <button className="btn btn-danger btn-sm mr-1" onClick={() => { setRevokeFor(c); setReason(''); }} title="Revoke"><Ban className="h-3.5 w-3.5" />Revoke</button>}
                        {c?.status === 'revoked' && c.recipient_id && <button className="btn btn-ghost btn-sm mr-1" onClick={() => reinstate(c)}><Undo2 className="h-3.5 w-3.5" />Reinstate</button>}
                        {c?.recipient_id && !purged && <button className="btn btn-ghost btn-sm" onClick={() => reissue(c)} title="Revoke and generate a corrected certificate">Reissue</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > shown.length && <p className="p-3 text-xs text-slate-500">Showing the first {shown.length} matches. Use search or filters to narrow down.</p>}
          </div>
        )}
      </div>

      <Modal open={!!revokeFor} onClose={() => setRevokeFor(null)} title="Revoke certificate"
        footer={<><button className="btn btn-ghost" onClick={() => setRevokeFor(null)}>Cancel</button><button className="btn btn-danger" onClick={doRevoke}>Revoke</button></>}>
        {revokeFor && (
          <div className="space-y-3 text-sm">
            <p>The verify page for <b>{revokeFor.recipient_name}</b> ({revokeFor.verification_code}) will show “revoked”, and any queued email will be cancelled. You can reinstate it later.</p>
            <Field label="Reason (shown on the verify page)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Issued with a wrong name" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
