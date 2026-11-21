import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);
export const supabase = isConfigured ? createClient(url, key) : null;
const isLocalHost = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';

// Hosts copied from .env.example / README (e.g. your-portal.vercel.app). These are NOT this portal.
const isPlaceholderHost = (h) =>
  /^your[-_.]|[-_.]your[-_.]|your-portal|your-project|your-domain|yourdomain|^example\.(com|org|edu|net)$/i.test(h || '');

const hostOf = (u) => String(u || '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();

const normalizeUrl = (u) => {
  let c = String(u || '').trim().replace(/\/+$/, '');
  if (!c) return '';
  if (!/^https?:\/\//i.test(c)) c = `https://${c}`;
  return c;
};

const usableEnvUrl = () => {
  const c = normalizeUrl(import.meta.env.VITE_PUBLIC_SITE_URL);
  if (!c) return '';
  const h = hostOf(c);
  return isLocalHost(h) || isPlaceholderHost(h) ? '' : c;
};

export const siteUrl = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/+$/, '');
    if (!isLocalHost(window.location.hostname || '')) return origin;
    return usableEnvUrl() || origin;
  }
  return usableEnvUrl();
};

export const qrSiteProblem = () => {
  const u = siteUrl();
  const h = hostOf(u);
  if (!u || isLocalHost(h)) {
    return 'Certificates generated from localhost will get a QR code that nobody can open. Generate them from your deployed site, or set VITE_PUBLIC_SITE_URL to your real public URL and restart.';
  }
  if (isPlaceholderHost(h)) {
    return `The site URL (${u}) is a placeholder, not your portal. Fix VITE_PUBLIC_SITE_URL / SITE_URL.`;
  }
  return '';
};

export const verifyUrl = (code) => `${siteUrl()}/verify/${encodeURIComponent(code || '')}`;