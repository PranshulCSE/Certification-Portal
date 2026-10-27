import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { useAuth } from './lib/auth';
import { PageLoader } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Events from './pages/Events';
import EventDetail from './pages/EventDetail';
import Issuers from './pages/Issuers';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import GlobalStore from './pages/GlobalStore';
import Verify from './pages/Verify';
import { BRAND } from './config/branding';

function SetupNeeded() {
  return (
    <div className="mx-auto mt-24 max-w-lg rounded-xl border border-line bg-white p-6">
      <h1 className="text-xl font-bold">Supabase is not configured</h1>
      <p className="mt-2 text-sm text-slate2">
        Copy <code>.env.example</code> to <code>.env</code>, fill <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server (or add them as environment variables on Vercel/Netlify and redeploy).
      </p>
    </div>
  );
}

function Blocked({ title, children }) {
  const { signOut } = useAuth();
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-line bg-white p-6 text-center">
      <img src={BRAND.logo} alt="" className="mx-auto mb-4 h-12" />
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="mt-2 text-sm text-slate2">{children}</p>
      <button className="btn btn-ghost mt-5" onClick={signOut}>Sign out</button>
    </div>
  );
}

function Protected({ children, admin = false }) {
  const { session, profile, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!profile) return <Blocked title="No access yet">This account has not been set up as an issuer. Ask the portal admin to create your issuer account.</Blocked>;
  if (profile.status !== 'active') return <Blocked title="Account suspended">Your issuer access has been suspended by the admin. Contact the admin if you think this is a mistake.</Blocked>;
  if (profile.must_change_password && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <Routes>
      <Route path="/verify/:code?" element={<Verify />} />
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<Protected><ChangePassword /></Protected>} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Events />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/global-store" element={<GlobalStore />} />
        <Route path="/issuers" element={<Protected admin><Issuers /></Protected>} />
        <Route path="/settings" element={<Protected admin><Settings /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
