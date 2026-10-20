import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { rpc, audit } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';
import { BRAND } from '../config/branding';

export default function ChangePassword() {
  const { refreshProfile, profile } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.length < 10) return setError('Use at least 10 characters.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) throw err;
      await rpc('complete_password_change');
      audit('auth.password_changed', 'profile', profile?.id);
      await refreshProfile();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <img src={BRAND.logo} alt="" className="mb-4 h-10" />
        <h1 className="font-display text-xl font-bold">Set your own password</h1>
        <p className="mt-1 text-sm text-slate2">{profile?.must_change_password ? 'You signed in with a temporary password. Choose a new one to continue.' : 'Choose a new password.'}</p>
        <div className="mt-5 space-y-4">
          <div><label className="label" htmlFor="pw">New password</label><input id="pw" type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label className="label" htmlFor="pw2">Confirm password</label><input id="pw2" type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy && <Spinner />}Save password</button>
        </div>
      </form>
    </div>
  );
}
