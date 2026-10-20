import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { EmptyState, PageLoader, useToast } from '../components/ui';

export default function Activity() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500)
      .then(({ data, error }) => { if (error) toast.error(error.message); setRows(data || []); });
  }, [toast]);

  if (!rows) return <PageLoader />;
  const shown = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Activity</h1>
          <p className="text-sm text-slate2">{isAdmin ? 'Everything done in the portal, newest first.' : 'Your actions in the portal, newest first.'} Showing the latest 500.</p>
        </div>
        <input className="input !w-64" placeholder="Search activity" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activity" />
      </div>
      <div className="card overflow-x-auto">
        {shown.length === 0 ? <EmptyState title="Nothing here yet" /> : (
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(r.created_at)}</td>
                  <td>{r.actor_name || '—'}</td>
                  <td><span className="badge badge-muted">{r.action}</span></td>
                  <td className="max-w-xl break-words font-mono text-xs text-slate2">{Object.keys(r.meta || {}).length ? JSON.stringify(r.meta) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
