// Shared helpers for all Edge Functions.
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
export const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await fn(req);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: (e as Error)?.message || "Unexpected error" }, 500);
  }
};

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Verifies the caller's JWT and returns their (active) profile.
// deno-lint-ignore no-explicit-any
export async function requireUser(req: Request, admin: any) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Session expired. Please sign in again.");
  const { data: profile } = await admin.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.status !== "active") throw new HttpError(403, "Your account is not active");
  return { user: data.user, profile };
}

export function transporter() {
  const user = Deno.env.get("SMTP_USER");
  const pass = (Deno.env.get("SMTP_APP_PASSWORD") || "").replace(/\s+/g, "");
  if (!user || !pass) throw new HttpError(500, "Mail is not configured: set the SMTP_USER and SMTP_APP_PASSWORD secrets.");
  return nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
}

const noNewlines = (s: string) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

export function fromAddress(displayName?: string | null) {
  const user = Deno.env.get("SMTP_USER")!;
  const name = noNewlines(displayName || Deno.env.get("SMTP_FROM_NAME") || "Certificate Portal").replace(/["<>]/g, "");
  return `"${name}" <${user}>`;
}
export const cleanSubject = noNewlines;

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Plain text -> simple HTML with clickable links and line breaks.
export function toHtml(text: string) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827">${body}</div>`;
}

export function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
