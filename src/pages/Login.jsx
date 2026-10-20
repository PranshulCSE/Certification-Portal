import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';
import { BRAND } from '../config/branding';

export default function Login() {
  const { signIn, session, loading } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!loading && session) return <Navigate to={loc.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await signIn(email, password);
    setBusy(false);
    if (err) setError(err.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : err.message);
    else navigate(loc.state?.from || '/', { replace: true });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="inline-flex w-fit rounded-xl bg-white px-4 py-3"><img src={BRAND.logo} alt={BRAND.universityName} className="h-12" /></div>
        <div>
          <h1 className="max-w-md font-display text-4xl font-bold leading-tight">Issue certificates people can actually verify.</h1>
          <p className="mt-4 max-w-md text-slate-300">Create events, upload participant lists, send certificates by email, and let anyone confirm them with a single scan.</p>
        </div>
        <p className="text-sm text-slate-400">{BRAND.footer}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <img src={BRAND.logo} alt="" className="mb-6 h-10 lg:hidden" />
          <h2 className="font-display text-2xl font-bold">Sign in</h2>
          <p className="mt-1 text-sm text-slate2">Issuer and admin accounts are created by the portal admin.</p>
          <div className="mt-6 space-y-4">
            <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className="label" htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy}>{busy && <Spinner />}Sign in</button>
          </div>
          <p className="mt-6 text-center text-sm text-slate2">Checking a certificate? Scan the QR code on it, or <a className="font-semibold text-saffron-700 underline" href="/verify">enter its ID</a>.</p>
        </form>
      </div>
    </div>
  );
}
