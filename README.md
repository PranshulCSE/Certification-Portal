# Certificate Portal

A multi-issuer certificate platform for university events.

- **Admin** (you) creates **issuers** (event coordinators), can see and revoke everything, controls the email speed.
- **Issuers** create **events** (e.g. *SIH Participation*), design a **template per event**, upload a **CSV / Excel / Google Sheet** of participants, then **generate, download (ZIP) and email** the certificates.
- **Anyone** can open `/verify/<code>` (or scan the QR on the certificate) to see if it is genuine, who issued it, and whether it was revoked.

Stack: React + Vite + Tailwind · Supabase (Auth, Postgres + RLS, Storage, Edge Functions) · Vercel/Netlify.

## What is included

| Area | Details |
|---|---|
| Roles | Admin, Issuer (invite-only, public sign-up must stay off) |
| Per-event | Template designer (drag & drop, fonts incl. Hindi, QR, logos, multiple signatories), participants, email template, analytics |
| Import | CSV, XLSX, Google Sheet link, add one; column mapping, validation, duplicate detection |
| Email | Queue + worker, per-minute throttle, daily cap, auto-resume next day, retries with backoff, status tracking, retry failed, resend, schedule for later, test email |
| Verify | Public page, university branding, issuer name shown, Revoked state, LinkedIn "Add to profile" |
| Safety | RLS on every table, issuer isolation, server-side snapshots (issuer cannot fake the issuer name), crypto-secure 12-char codes, verify rate-limit, audit log, suspend issuer, revoke / reissue, participant data purge |

## Setup (about 30 minutes)

### 1. Supabase project
1. Create a project at supabase.com.
2. **Authentication → Providers → Email**: keep Email enabled, turn **"Allow new users to sign up" OFF** (only the admin creates accounts).
3. **SQL Editor** → paste and run `supabase/migrations/001_schema.sql`. This creates tables, security policies, functions and the two storage buckets (`event-assets` public, `certificates` private).

### 2. Create your admin account
1. **Authentication → Users → Add user** (your email + a strong password, tick *Auto confirm*).
2. In the SQL Editor run (use your email):
```sql
insert into public.profiles (id, role, full_name, department, email, status)
select id, 'admin', 'Your Name', 'Admin', email, 'active' from auth.users where email = 'YOUR_EMAIL';
```

### 3. Google App Password for the sender mailbox
1. Sign in to the university Google account you want to send from (a dedicated one like `certificates@...` is best).
2. Turn on **2-Step Verification** (Google Account → Security).
3. Google Account → Security → **App passwords** → create one named "Certificate Portal" → copy the 16 characters.
4. If the App passwords option is missing, the Workspace admin has disabled it. Ask the university IT team to allow app passwords (or SMTP) for this account.

### 4. Edge Functions
Install the CLI (`npm i -g supabase`), then from this folder:
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

supabase secrets set SMTP_USER="certificates@yourdomain.edu" \
                     SMTP_APP_PASSWORD="abcd efgh ijkl mnop" \
                     SMTP_FROM_NAME="Geeta University" \
                     CRON_SECRET="$(openssl rand -hex 24)" \
                     SITE_URL="https://your-portal.vercel.app"

supabase functions deploy process-queue --no-verify-jwt
supabase functions deploy send-test
supabase functions deploy admin-users
supabase functions deploy fetch-sheet
```
Note the `CRON_SECRET` value (`supabase secrets list` does not show it, so copy it from the command above).

### 5. Start the email worker (every minute)
Open `supabase/cron.sql`, put in your project ref and the same `CRON_SECRET`, run it in the SQL Editor.
Without this the **Send next batch** button still works, but nothing sends automatically.

### 6. Frontend
```bash
cp .env.example .env     # fill the 3 values
npm install
npm run dev              # local
npm run build            # production build in dist/
```
Deploy on **Vercel** or **Netlify** (import the repo, add the same 3 env vars, build command `npm run build`, output `dist`). SPA rewrites are already configured (`vercel.json`, `public/_redirects`).

> **Decide the final site URL before issuing real certificates.** The URL is baked into every QR code. Set `VITE_PUBLIC_SITE_URL` to it. If you later move to a custom domain, old QR codes keep pointing at the old URL.

### 7. First-run checklist
1. Sign in as admin → **Settings** → **Send test email to me**. If it arrives, the App Password works.
2. **Issuers → Add issuer**. They receive a temporary password (by email and shown to you once) and must set their own at first login.
3. Create an event, design the template, import 2-3 test participants (use your own emails), generate, queue, and confirm the mail and the verify page.

## Using it (issuer flow)
1. **New event** → name, organizer, date, sender name, reply-to.
2. **Template** → upload the template image (PNG/JPG, ideally A4 at 150-300 dpi), drag the name/text, add logo and signatory images, adjust fonts. Use `{{name}}`, `{{event}}`, `{{date}}`, `{{code}}`, or any column from your file, e.g. `{{rank}}`. **Save template**.
3. **Participants** → upload CSV/Excel or a Google Sheet. Choose the name and email columns, review, import.
4. **Email** → edit subject/body, **Send test to me**.
5. **Generate & send** → *Generate certificates* → *Queue emails* (now or scheduled) → watch statuses. *Download all as ZIP* any time.
6. **Data & privacy** → after the event, delete participant emails and PDFs; certificates stay verifiable.

## Email limits (important)
Google Workspace allows roughly **2,000 emails per mailbox per rolling 24 hours** (consumer Gmail ~500). The portal never exceeds the **daily cap** you set in *Settings* (default 1,500), sends **N per minute**, and continues the next day automatically. If Google still blocks the mailbox, the worker pauses for an hour and retries. Check current limits in Google's documentation, they can change.

## Security notes
- The **service-role key and SMTP password live only in Supabase secrets**. Never add them to `.env` or any `VITE_` variable (those are shipped to the browser).
- Issuers can only touch their own events (RLS). Suspending an issuer blocks reads and writes immediately and pauses their queued mail.
- Event name and organizer are typed by issuers. The **issuer's name and department on the verify page come from the database** (set by you), so keep issuer names accurate and use *Revoke* for takedowns.
- The verify function rate-limits failed lookups per IP (30 / 10 min). For extra protection add a rate-limit rule on your hosting provider.
- `.xlsx` parsing uses `read-excel-file` (not SheetJS) on purpose.

## Project layout
```
supabase/migrations/001_schema.sql   tables, RLS, RPC functions, storage
supabase/functions/                  process-queue, send-test, admin-users, fetch-sheet
supabase/cron.sql                    per-minute worker schedule
src/config/branding.js               university name/logo/footer for the verify page
src/lib/render.js                    canvas certificate renderer + PDF
src/pages/event/*                    Overview, Template designer, Participants, Email, Generate & send, Privacy
```

## Known limits
- Certificates are rendered in the issuer's browser. Keep the tab open while *Generate* runs (it resumes if interrupted). Very large events (3,000+) are better generated in a few batches.
- Email open tracking is intentionally not included (unreliable); analytics use verify-page views.
- Replacing a template image after generating does not change certificates already generated.
