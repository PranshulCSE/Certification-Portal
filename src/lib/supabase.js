import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);
export const supabase = isConfigured ? createClient(url, key) : null;

const isLocalHost = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';

export const siteUrl = () => {
  let envUrl = (import.meta.env.VITE_PUBLIC_SITE_URL || '').trim();
  const browserOrigin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  const browserHostname = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : '';

  let url = envUrl;

  // If envUrl is empty, or if envUrl points to localhost/127.0.0.1 but the app is running on a remote host (e.g. deployed to Vercel),
  // prefer the actual browser origin so deployed sites never generate certificates pointing to localhost.
  if (browserOrigin) {
    const envHost = url.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    if (!url || (isLocalHost(envHost) && !isLocalHost(browserHostname))) {
      url = browserOrigin;
    }
  }

  if (!url && browserOrigin) {
    url = browserOrigin;
  }

  // Ensure url always has a protocol (http:// or https://)
  if (url && !/^https?:\/\//i.test(url)) {
    const host = url.replace(/\/.*$/, '').split(':')[0];
    url = `${isLocalHost(host) ? 'http' : 'https'}://${url}`;
  }

  return (url || '').replace(/\/+$/, '');
};

export const verifyUrl = (code) => `${siteUrl()}/verify/${encodeURIComponent(code || '')}`;
