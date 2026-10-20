import React, { useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { rpc } from '../../lib/api';
import { chunk, formatDateTime } from '../../lib/format';
import { Spinner, useToast } from '../../components/ui';

export default function PrivacyTab({ ctx }) {
  const { event, recipients, reload } = ctx;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const purged = event.status === 'purged';

  const purge = async () => {
    setBusy(true);
    try {
      const paths = await rpc('purge_event_data', { p_event: event.id });
      for (const part of chunk(paths || [], 100)) {
        const { error } = await supabase.storage.from('certificates').remove(part);
        if (error) console.error(error);
      }
      toast.ok('Participant emails and certificate files deleted');
      setConfirm('');
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
          <div className="text-sm">
            <h2 className="font-display text-base font-semibold">What stays and what goes</h2>
            <p className="mt-2 text-slate2">When you delete participant data, the portal removes the participant list (names, emails and extra columns), the email queue and history, and the generated PDF files.</p>
            <p className="mt-2 text-slate2">It <b className="text-ink">keeps</b> one minimal record per certificate: recipient name, event, issuer, dates and verification code. That is what lets the QR code and verify page keep working for anyone who holds a certificate.</p>
          </div>
        </div>
      </div>

      <div className="card border-red-200 p-5">
        <h2 className="font-display text-base font-semibold text-bad">Delete participant data</h2>
        {purged ? (
          <p className="mt-2 text-sm text-slate2">Participant data for this event was deleted{event.purged_at ? ` on ${formatDateTime(event.purged_at)}` : ''}. Certificates remain verifiable.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate2">This cannot be undone. Currently stored: <b>{recipients.length}</b> participants. Make sure you have downloaded the ZIP of certificates first if you need it. After this, no more certificates can be generated for this event.</p>
            <label className="label mt-4" htmlFor="confirm">Type the event name to confirm</label>
            <input id="confirm" className="input" placeholder={event.name} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn btn-danger mt-3" onClick={purge} disabled={busy || confirm.trim() !== event.name.trim()}>{busy ? <Spinner /> : <Trash2 className="h-4 w-4" />}Delete participant data</button>
          </>
        )}
      </div>
    </div>
  );
}
