import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../lib/api';
import { formatDate } from '../lib/format';
import { PageLoader, useToast } from '../components/ui';
import Overview from './event/Overview';
import TemplateDesigner from './event/TemplateDesigner';
import RecipientsTab from './event/RecipientsTab';
import EmailTab from './event/EmailTab';
import IssueTab from './event/IssueTab';
import PrivacyTab from './event/PrivacyTab';

const TABS = [
  ['overview', 'Overview'],
  ['template', 'Template'],
  ['recipients', 'Participants'],
  ['email', 'Email'],
  ['issue', 'Generate & send'],
  ['privacy', 'Data & privacy'],
];

export default function EventDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { data: event, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!event) { setMissing(true); return; }
      const [tplRes, recipients, certs, jobs, owner] = await Promise.all([
        supabase.from('event_templates').select('*').eq('event_id', id).maybeSingle(),
        fetchAll(() => supabase.from('recipients').select('*').eq('event_id', id).order('created_at').order('id')),
        fetchAll(() => supabase.from('certificates').select('*').eq('event_id', id).order('created_at').order('id')),
        fetchAll(() => supabase.from('email_jobs').select('id,event_id,certificate_id,to_email,to_name,status,attempts,last_error,scheduled_at,sent_at,created_at').eq('event_id', id).order('created_at').order('id')),
        supabase.from('profiles').select('full_name, department').eq('id', event.owner_id).maybeSingle(),
      ]);
      setData({ event, template: tplRes.data, recipients, certs, jobs, owner: owner.data || { full_name: '', department: '' } });
    } catch (e) {
      toast.error(e.message);
    }
  }, [id, toast]);

  useEffect(() => { setData(null); setMissing(false); reload(); }, [reload]);

  if (missing) return <p className="mt-10 text-center text-slate2">This event was not found, or you do not have access to it.</p>;
  if (!data) return <PageLoader />;
  const ctx = { ...data, reload, ownerName: data.owner.full_name };
  const { event } = data;

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate2 hover:text-ink"><ArrowLeft className="h-4 w-4" />All events</Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold">{event.name}</h1>
        {event.status === 'purged' && <span className="badge badge-warn">Participant data purged</span>}
        <span className="text-sm text-slate2">{[event.organizer, formatDate(event.event_date)].filter(Boolean).join(' · ')}</span>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}
            className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${tab === k ? 'border-saffron-600 text-ink' : 'border-transparent text-slate2 hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview ctx={ctx} />}
      {tab === 'template' && <TemplateDesigner ctx={ctx} />}
      {tab === 'recipients' && <RecipientsTab ctx={ctx} />}
      {tab === 'email' && <EmailTab ctx={ctx} />}
      {tab === 'issue' && <IssueTab ctx={ctx} />}
      {tab === 'privacy' && <PrivacyTab ctx={ctx} />}
    </div>
  );
}
