import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, ShieldAlert, SearchX, Linkedin, Link2, Printer } from 'lucide-react';
import { supabase, verifyUrl } from '../lib/supabase';
import { formatDate } from '../lib/format';
import { BRAND } from '../config/branding';
import { copyText, Spinner } from '../components/ui';

function linkedinUrl(c) {
  const d = new Date(c.issue_date);
  const p = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: String(c.event_name || 'Certificate').slice(0, 100),
    organizationName: BRAND.universityName,
    issueYear: String(d.getFullYear()),
    issueMonth: String(d.getMonth() + 1),
    certUrl: verifyUrl(c.code),
    certId: c.code,
  });
  return `https://www.linkedin.com/profile/add?${p.toString()}`;
}

export default function Verify() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code || '');
  const [state, setState] = useState({ loading: !!code, result: null, error: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!code) { setState({ loading: false, result: null, error: '' }); return; }
    let alive = true;
    setState({ loading: true, result: null, error: '' });
    supabase.rpc('verify_certificate', { p_code: code }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setState({ loading: false, result: null, error: 'Verification is unavailable right now. Please try again in a moment.' });
      else setState({ loading: false, result: data, error: '' });
    });
    return () => { alive = false; };
  }, [code]);

  const submit = (e) => {
    e.preventDefault();
    const v = input.trim();
    if (v) navigate(`/verify/${encodeURIComponent(v)}`);
  };

  const r = state.result;
  const valid = r?.found && r.status === 'issued';
  const revoked = r?.found && r.status === 'revoked';

  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <img src={BRAND.logo} alt={BRAND.universityName} className="h-10 w-auto" />
          <div className="leading-tight">
            <p className="font-display text-base font-bold">{BRAND.universityName}</p>
            <p className="text-xs text-slate2">{BRAND.verifyTitle}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <form onSubmit={submit} className="card flex flex-col gap-2 p-4 sm:flex-row">
          <input className="input font-mono uppercase tracking-wider" placeholder="Certificate ID, e.g. ABCD-EFGH-JKMN" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Certificate ID" />
          <button className="btn btn-primary shrink-0">Verify</button>
        </form>

        {state.loading && <div className="mt-10 flex justify-center text-slate2"><Spinner className="mr-2" />Checking…</div>}
        {state.error && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-bad">{state.error}</p>}

        {code && !state.loading && r && !r.found && (
          <div className="card mt-6 border-red-200 p-8 text-center">
            <SearchX className="mx-auto h-12 w-12 text-bad" />
            <h1 className="mt-3 font-display text-xl font-bold">{r.rate_limited ? 'Too many attempts' : 'No certificate found'}</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate2">
              {r.rate_limited ? 'Please wait a few minutes before trying again.' : 'We could not find a certificate with this ID. Check the ID for typos, or scan the QR code printed on the certificate. A certificate that does not appear here was not issued through this portal.'}
            </p>
          </div>
        )}

        {r?.found && (
          <article className={`card mt-6 overflow-hidden ${revoked ? 'border-red-200' : 'border-emerald-200'}`}>
            <div className={`flex items-center gap-3 px-6 py-4 ${revoked ? 'bg-red-50 text-bad' : 'bg-emerald-50 text-ok'}`}>
              {revoked ? <ShieldAlert className="h-7 w-7" /> : <BadgeCheck className="h-7 w-7" />}
              <div>
                <h1 className="font-display text-lg font-bold">{revoked ? 'This certificate has been revoked' : 'Verified certificate'}</h1>
                <p className="text-sm opacity-90">{revoked ? `Revoked on ${formatDate(r.revoked_at)}. It is no longer valid.` : 'This certificate was issued through the university certificate portal.'}</p>
              </div>
            </div>

            <div className="px-6 py-6">
              <p className="text-sm text-slate2">Awarded to</p>
              <p className="font-display text-3xl font-bold">{r.recipient_name}</p>
              <p className="mt-1 text-slate2">for <b className="text-ink">{r.event_name}</b></p>

              <dl className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-semibold text-slate2">Issued by</dt><dd className="mt-0.5 font-semibold">{r.issuer_name}{r.issuer_department ? `, ${r.issuer_department}` : ''}</dd><dd className="text-slate2">{BRAND.universityName}</dd></div>
                <div><dt className="text-xs font-semibold text-slate2">Organized by</dt><dd className="mt-0.5 font-semibold">{r.organizer || '—'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate2">Event date</dt><dd className="mt-0.5 font-semibold">{formatDate(r.event_date) || '—'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate2">Issue date</dt><dd className="mt-0.5 font-semibold">{formatDate(r.issue_date)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate2">Certificate ID</dt><dd className="mt-0.5 font-mono font-semibold tracking-wider">{r.code}</dd></div>
                {revoked && r.revoke_reason && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate2">Reason</dt><dd className="mt-0.5">{r.revoke_reason}</dd></div>}
              </dl>

              <p className="mt-6 rounded-lg bg-mist p-3 text-xs text-slate2">{BRAND.verifyNote}</p>

              <div className="mt-5 flex flex-wrap gap-2 print:hidden">
                {valid && <a className="btn btn-accent" href={linkedinUrl(r)} target="_blank" rel="noreferrer"><Linkedin className="h-4 w-4" />Add to LinkedIn profile</a>}
                <button className="btn btn-ghost" onClick={async () => { if (await copyText(verifyUrl(r.code))) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}><Link2 className="h-4 w-4" />{copied ? 'Link copied' : 'Copy link'}</button>
                <button className="btn btn-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
              </div>
            </div>
          </article>
        )}

        {!code && !state.loading && <p className="mt-8 text-center text-sm text-slate2">Enter the Certificate ID printed on the certificate, or scan its QR code.</p>}
      </main>
      <footer className="pb-8 text-center text-xs text-slate-500">{BRAND.footer}</footer>
    </div>
  );
}
