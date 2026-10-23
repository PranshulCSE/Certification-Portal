import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

export async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export const handleApi = (fn) => async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type, x-cron-secret');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end('ok');
  }

  try {
    req.parsedBody = await getBody(req);
    return await fn(req, res);
  } catch (e) {
    if (e instanceof HttpError) {
      return sendJson(res, { error: e.message }, e.status);
    }
    console.error(e);
    return sendJson(res, { error: e?.message || 'Unexpected error' }, 500);
  }
};

export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new HttpError(
      500,
      'Backend configuration error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in environment variables.'
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req, admin) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Not signed in');

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Session expired. Please sign in again.');

  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!profile || profile.status !== 'active') throw new HttpError(403, 'Your account is not active');

  return { user: data.user, profile };
}

export function transporter() {
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) {
    throw new HttpError(500, 'Mail is not configured: set the SMTP_USER and SMTP_APP_PASSWORD environment variables.');
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    auth: { user, pass },
  });
}

export const noNewlines = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

export function fromAddress(displayName) {
  const user = process.env.SMTP_USER || '';
  const name = noNewlines(displayName || process.env.SMTP_FROM_NAME || 'Certificate Portal').replace(/["<>]/g, '');
  return `"${name}" <${user}>`;
}

export const cleanSubject = noNewlines;

export const cleanReplyTo = (s) => (s ? noNewlines(s).replace(/["<>\r\n]/g, '').trim() || undefined : undefined);

export function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toHtml(text) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+?)([.!,?;)]?(?:\s|<|$))/g, '<a href="$1">$1</a>$2')
    .replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">${body}</div>`;
}

export function b64ToBytes(b64) {
  return Buffer.from(b64, 'base64');
}
