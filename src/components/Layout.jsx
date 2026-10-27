import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { BRAND } from '../config/branding';

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const link = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${isActive ? 'bg-ink text-white' : 'text-slate2 hover:bg-mist hover:text-ink'}`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-5 px-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-3" aria-label="Home">
            <img src={BRAND.logo} alt={BRAND.universityName} className="h-10 w-auto" />
            <span className="hidden font-display text-base font-bold sm:block">{BRAND.portalName}</span>
          </button>
          <nav className="ml-2 flex items-center gap-1">
            <NavLink to="/" end className={link}>Events</NavLink>
            <NavLink to="/global-store" className={link}>Global Store</NavLink>
            {isAdmin && <NavLink to="/issuers" className={link}>Issuers</NavLink>}
            <NavLink to="/activity" className={link}>Activity</NavLink>
            {isAdmin && <NavLink to="/settings" className={link}>Settings</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{profile?.full_name || 'User'}</p>
              <p className="text-xs leading-tight text-slate-500">{isAdmin ? 'Admin' : profile?.department || 'Issuer'}</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={signOut} title="Sign out"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6"><Outlet /></main>
    </div>
  );
}
