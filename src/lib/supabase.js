import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);
export const supabase = isConfigured ? createClient(url, key) : null;

const isLocalHost = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';

export const siteUrl = () => {
  // If running in browser:
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/+$/, '');
    const hostname = window.location.hostname || '';
    const isLocal = isLocalHost(hostname);

    // If running on a live deployed site (e.g. Vercel, university domain),
    // ALWAYS use the current origin so stale environment variables from cloned repos cannot hijack the QR code.
    if (!isLocal) {
      return origin;
    }

    // In local development, if VITE_PUBLIC_SITE_URL is explicitly set to a public remote URL (e.g. ngrok tunnel), use it.
    const envUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || '').trim();
    if (envUrl) {
      const envHost = envUrl.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
      if (!isLocalHost(envHost)) {
        let clean = envUrl.replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
        return clean;
      }
    }

    return origin;
  }

  // Fallback for non-browser environments:
  let envUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && !/^https?:\/\//i.test(envUrl)) {
    const host = envUrl.replace(/\/.*$/, '').split(':')[0];
    envUrl = `${isLocalHost(host) ? 'http' : 'https'}://${envUrl}`;
  }
  return envUrl || '';
};

export const verifyUrl = (code) => `${siteUrl()}/verify/${encodeURIComponent(code || '')}`;
