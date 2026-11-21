<div align="center">

# 🎓 Certificate Portal

### A secure, multi-issuer certificate generation, delivery & verification platform for university events

![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-CSS-06B6D4?logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%7C%20Postgres%20%7C%20Storage%20%7C%20Edge-3ECF8E?logo=supabase&logoColor=white)
![Deploy](https://img.shields.io/badge/Deploy-Vercel%20%7C%20Netlify-000000?logo=vercel&logoColor=white)

**Designed, developed & owned by [Pranshul Threja](https://github.com/PranshulCSE)**

</div>

---

## 📌 Overview

**Certificate Portal** is a full-stack platform that lets a university run certificate issuance for all its events from one place: hackathons, workshops, competitions, seminars and more.

- 👑 **Admin** creates **issuers** (event coordinators), can see and revoke everything, and controls the email sending speed.
- 🧑‍🏫 **Issuers** create **events** (e.g. *SIH Participation*), design a **template per event**, upload a **CSV / Excel / Google Sheet** of participants, then **generate, download (ZIP) and email** the certificates.
- 🌐 **Anyone** can open `/verify/<code>` (or scan the QR code printed on the certificate) to check whether it is genuine, who issued it, and whether it has been revoked.

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS |
| Backend / BaaS | Supabase (Auth, Postgres + RLS, Storage, Edge Functions) |
| Email | Google Workspace SMTP via App Password (queue + worker) |
| Certificate rendering | Browser canvas renderer + PDF export |
| Hosting | Vercel or Netlify (SPA rewrites preconfigured) |

---

## ✨ Features

### 👥 Roles & Access
- **Admin** and **Issuer** roles
- **Invite-only**: public sign-up must stay OFF, only the admin creates accounts
- Issuers receive a temporary password (by email and shown to admin once) and must set their own at first login
- Admin can **suspend an issuer**: reads/writes are blocked immediately and their queued mail is paused

### 🎨 Per-Event Template Designer
- Upload a template image (PNG/JPG, ideally A4 at 150–300 dpi)
- **Drag & drop** positioning of text, name, logos and signatory images
- Fonts including **Hindi / Devanagari** support
- **QR code** placement on the certificate
- **Multiple signatories** and logos
- Dynamic placeholders: `{{name}}`, `{{event}}`, `{{date}}`, `{{code}}` or **any column from your uploaded file** (e.g. `{{rank}}`)

### 📥 Participant Import
- **CSV**, **XLSX**, **Google Sheet link**, or **add one manually**
- Column mapping (choose name and email columns)
- Validation and **duplicate detection**
- Review step before final import

### 📧 Email Delivery System
- **Queue + background worker** architecture
- **Per-minute throttle** and configurable **daily cap**
- **Auto-resume next day** when the cap is reached
- **Retries with exponential backoff**
- Live **status tracking**, **retry failed**, **resend**
- **Schedule for later**
- **Send test email** (to self) for both the mailbox setup and the email template
- Editable subject/body per event

### ✅ Public Verification
- Public `/verify/<code>` page with **university branding**
- Shows the **issuer name** and department, event details and holder
- Clear **Revoked** state
- **LinkedIn "Add to profile"** button
- QR code on every certificate links straight to verification

### 📊 Analytics
- Per-event analytics based on **verify-page views**
- Email status overview (queued / sent / failed)

### 📦 Output Options
- Generate certificates in-browser and **download all as ZIP** at any time
- Email directly to participants

### 🔒 Security & Safety
- **Row Level Security (RLS) on every table** with strict **issuer isolation**
- **Server-side snapshots**: issuers cannot fake the issuer name on the verify page
- **Crypto-secure 12-character** certificate codes
- **Verify rate-limit** for failed lookups (30 per 10 minutes per IP)
- **Audit log**
- **Revoke / reissue** certificates
- **Participant data purge**: delete emails and PDFs after the event while certificates stay verifiable
- Service-role key and SMTP password live **only in Supabase secrets**
- `.xlsx` parsing uses `read-excel-file` (not SheetJS) on purpose

---

## 🏗️ Project Layout

```
supabase/migrations/001_schema.sql   tables, RLS, RPC functions, storage buckets
supabase/functions/                  process-queue, send-test, admin-users, fetch-sheet
supabase/cron.sql                    per-minute email worker schedule
src/config/branding.js               university name / logo / footer for the verify page
src/lib/render.js                    canvas certificate renderer + PDF
src/pages/event/*                    Overview, Template designer, Participants, Email, Generate & send, Privacy
```

---

## ⚙️ Setup Guide (about 30 minutes)

### 1. Supabase project
1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email**: keep Email enabled and turn **"Allow new users to sign up" OFF**.
3. **SQL Editor** → paste and run `supabase/migrations/001_schema.sql`. This creates tables, security policies, functions and two storage buckets: `event-assets` (public) and `certificates` (private).

### 2. Create your admin account
1. **Authentication → Users → Add user** (your email + a strong password, tick *Auto confirm*).
2. In the SQL Editor run (use your email):

```sql
insert into public.profiles (id, role, full_name, department, email, status)
select id, 'admin', 'Your Name', 'Admin', email, 'active'
from auth.users where email = 'YOUR_EMAIL';
```

### 3. Google App Password for the sender mailbox
1. Sign in to the university Google account you want to send from (a dedicated one like `certificates@...` is best).
2. Turn on **2-Step Verification** (Google Account → Security).
3. Google Account → Security → **App passwords** → create one named "Certificate Portal" → copy the 16 characters.
4. If the App passwords option is missing, the Workspace admin has disabled it. Ask the university IT team to allow app passwords (or SMTP) for this account.

### 4. Edge Functions
Install the CLI (`npm i -g supabase`), then from the project folder:

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

> 📝 Note the `CRON_SECRET` value. `supabase secrets list` does not show it, so copy it from the command above.

### 5. Start the email worker (every minute)
Open `supabase/cron.sql`, put in your project ref and the same `CRON_SECRET`, then run it in the SQL Editor.
Without this, the **Send next batch** button still works, but nothing sends automatically.

### 6. Frontend
```bash
cp .env.example .env     # fill the 3 values
npm install
npm run dev              # local development
npm run build            # production build in dist/
```

Deploy on **Vercel** or **Netlify**: import the repo, add the same 3 env vars, build command `npm run build`, output directory `dist`. SPA rewrites are already configured (`vercel.json`, `public/_redirects`).

> ⚠️ **Decide the final site URL before issuing real certificates.** The URL is baked into every QR code. Set `VITE_PUBLIC_SITE_URL` to it. If you later move to a custom domain, old QR codes keep pointing at the old URL.

### 7. First-run checklist
1. Sign in as admin → **Settings** → **Send test email to me**. If it arrives, the App Password works.
2. **Issuers → Add issuer**. They receive a temporary password and must set their own at first login.
3. Create an event, design the template, import 2–3 test participants (use your own emails), generate, queue, and confirm both the mail and the verify page.

---

## 🧑‍🏫 Issuer Workflow

1. **New event**: name, organizer, date, sender name, reply-to.
2. **Template**: upload the template image, drag the name/text, add logo and signatory images, adjust fonts. Use `{{name}}`, `{{event}}`, `{{date}}`, `{{code}}` or any column such as `{{rank}}`. Click **Save template**.
3. **Participants**: upload CSV/Excel or a Google Sheet, choose the name and email columns, review, import.
4. **Email**: edit subject/body, then **Send test to me**.
5. **Generate & send**: *Generate certificates* → *Queue emails* (now or scheduled) → watch statuses. *Download all as ZIP* any time.
6. **Data & privacy**: after the event, delete participant emails and PDFs. Certificates stay verifiable.

---

## 📬 Email Limits (Important)

Google Workspace allows roughly **2,000 emails per mailbox per rolling 24 hours** (consumer Gmail ~500). The portal:

- never exceeds the **daily cap** you set in *Settings* (default 1,500)
- sends **N emails per minute**
- continues the next day automatically
- pauses for an hour and retries if Google still blocks the mailbox

Check Google's current documentation for limits, as they can change.

---

## 🛡️ Security Notes

- The **service-role key and SMTP password live only in Supabase secrets**. Never add them to `.env` or any `VITE_` variable (those are shipped to the browser).
- Issuers can only touch their own events (RLS). Suspending an issuer blocks reads and writes immediately and pauses their queued mail.
- Event name and organizer are typed by issuers. The **issuer's name and department on the verify page come from the database** (set by the admin), so keep issuer names accurate and use *Revoke* for takedowns.
- The verify function rate-limits failed lookups per IP (30 / 10 min). For extra protection, add a rate-limit rule on your hosting provider.

---

## ⚠️ Known Limits

- Certificates are rendered in the issuer's browser. Keep the tab open while *Generate* runs (it resumes if interrupted). Very large events (3,000+) are better generated in a few batches.
- Email open tracking is intentionally not included (unreliable). Analytics use verify-page views.
- Replacing a template image after generating does not change certificates already generated.

---

## 👨‍💻 Author & Owner

**Pranshul Threja**
MCA Student, Geeta University (Batch 2025–2027) · Full-Stack Developer (MERN + Gen AI)

- 🌐 Website: [pranshulthreja.tech](https://pranshulthreja.tech)
- 💻 GitHub: [@PranshulCSE](https://github.com/PranshulCSE)

This project was conceptualised, designed, developed and is maintained by **Pranshul Threja**.

---

## 📄 License

© 2026 **Pranshul Threja**. All rights reserved.

---

<div align="center">

Built with ❤️ by **Pranshul Threja**

⭐ If you find this project useful, consider giving it a star!

</div>
