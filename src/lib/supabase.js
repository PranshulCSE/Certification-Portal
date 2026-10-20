import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);
export const supabase = isConfigured ? createClient(url, key) : null;

export const siteUrl = () =>
  (import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin).replace(/\/+$/, '');

export const verifyUrl = (code) => `${siteUrl()}/verify/${encodeURIComponent(code)}`;
