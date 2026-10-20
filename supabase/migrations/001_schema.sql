-- =============================================================================
-- CERTIFICATE PORTAL - DATABASE SCHEMA
-- Run once in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- Order: tables -> functions -> triggers -> RLS policies -> storage.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'issuer')),
  full_name text not null default '',
  department text not null default '',
  email text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  must_change_password boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  daily_cap int not null default 1500 check (daily_cap between 1 and 100000),
  batch_size int not null default 20 check (batch_size between 1 and 200),
  sending_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null,
  organizer text not null default '',
  event_date date,
  sender_display_name text not null default '',
  reply_to text not null default '',
  email_subject text not null default 'Your certificate for {{event}}',
  email_body text not null default E'Dear {{name}},\n\nCongratulations! Please find your certificate for {{event}}, organized by {{organizer}}, attached to this email.\n\nYou can verify its authenticity at any time using this link:\n{{verify_url}}\n\nCertificate ID: {{code}}\n\nRegards,\n{{issuer}}',
  status text not null default 'active' check (status in ('active', 'purged')),
  purged_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_events_owner on public.events (owner_id);

create table if not exists public.event_templates (
  event_id uuid primary key references public.events(id) on delete cascade,
  image_path text,
  width int not null default 1754,
  height int not null default 1240,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.recipients (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  email text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_recipients_event on public.recipients (event_id);
create unique index if not exists uq_recipients_event_email
  on public.recipients (event_id, lower(email)) where email is not null;

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  recipient_id uuid references public.recipients(id) on delete set null,
  verification_code text not null unique
    check (verification_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  recipient_name text not null,
  -- Snapshot columns are filled by a trigger from the database, never from the client.
  event_name text,
  organizer text,
  event_date date,
  issuer_name text,
  issuer_department text,
  issue_date date not null default current_date,
  fields_snapshot jsonb not null default '{}'::jsonb,
  pdf_path text,
  pdf_ready boolean not null default false,
  status text not null default 'issued' check (status in ('issued', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_certificates_event on public.certificates (event_id);
create index if not exists idx_certificates_recipient on public.certificates (recipient_id);

create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  certificate_id uuid not null references public.certificates(id) on delete cascade,
  to_email text not null,
  to_name text,
  from_name text,
  reply_to text,
  subject text not null,
  body text not null,
  attachment_name text not null default 'certificate.pdf',
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'bounced', 'cancelled')),
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_email_jobs_queue on public.email_jobs (status, scheduled_at);
create index if not exists idx_email_jobs_event on public.email_jobs (event_id);
create index if not exists idx_email_jobs_sent_at on public.email_jobs (sent_at) where status = 'sent';
-- Only one active job per certificate (prevents double-queueing).
create unique index if not exists uq_email_jobs_active
  on public.email_jobs (certificate_id) where status in ('queued', 'sending');

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  actor_name text,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_actor on public.audit_logs (actor_id);

create table if not exists public.certificate_views (
  id bigserial primary key,
  certificate_id uuid not null references public.certificates(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists idx_views_cert on public.certificate_views (certificate_id, viewed_at);

create table if not exists public.verify_failures (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists idx_verify_failures on public.verify_failures (ip, at);

-- -----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS (used by RLS)
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.owns_event(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events where id = eid and owner_id = auth.uid());
$$;

create or replace function public.can_read_event(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.owns_event(eid) and public.is_active()) or public.is_admin();
$$;

create or replace function public.can_write_event(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.owns_event(eid) and public.is_active()) or public.is_admin();
$$;

create or replace function public.event_from_path(p text)
returns uuid language plpgsql immutable as $$
begin
  return (string_to_array(p, '/'))[1]::uuid;
exception when others then
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- 3. RPC FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function public.log_audit(p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then return; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_name, action, entity, entity_id, meta)
  values (auth.uid(), coalesce(v_name, ''), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
end $$;

create or replace function public.complete_password_change()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

create or replace function public.revoke_certificate(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_id;
  if not found then raise exception 'Certificate not found'; end if;
  if not public.can_write_event(c.event_id) then raise exception 'Not allowed'; end if;
  update public.certificates
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revoke_reason = nullif(trim(p_reason), '')
   where id = p_id;
  update public.email_jobs set status = 'cancelled' where certificate_id = p_id and status = 'queued';
  perform public.log_audit('certificate.revoked', 'certificate', p_id::text,
    jsonb_build_object('code', c.verification_code, 'name', c.recipient_name, 'reason', p_reason));
end $$;

create or replace function public.reinstate_certificate(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_id;
  if not found then raise exception 'Certificate not found'; end if;
  if not public.can_write_event(c.event_id) then raise exception 'Not allowed'; end if;
  update public.certificates
     set status = 'issued', revoked_at = null, revoked_by = null, revoke_reason = null
   where id = p_id;
  perform public.log_audit('certificate.reinstated', 'certificate', p_id::text,
    jsonb_build_object('code', c.verification_code, 'name', c.recipient_name));
end $$;

-- Revoke the old certificate and detach it from the recipient so a corrected one can be generated.
create or replace function public.reissue_certificate(p_id uuid, p_reason text default 'Reissued')
returns void language plpgsql security definer set search_path = public as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_id;
  if not found then raise exception 'Certificate not found'; end if;
  if not public.can_write_event(c.event_id) then raise exception 'Not allowed'; end if;
  perform public.revoke_certificate(p_id, coalesce(nullif(trim(p_reason), ''), 'Reissued'));
  update public.certificates set recipient_id = null where id = p_id;
end $$;

create or replace function public.mark_pdfs_ready(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.certificates
     set pdf_ready = true
   where id = any (p_ids) and public.can_write_event(event_id);
$$;

create or replace function public.retry_job(p_id uuid, p_email text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.email_jobs; v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  select * into j from public.email_jobs where id = p_id;
  if not found then raise exception 'Job not found'; end if;
  if not public.can_write_event(j.event_id) then raise exception 'Not allowed'; end if;
  if j.status not in ('failed', 'bounced', 'cancelled', 'sent') then
    raise exception 'Only finished jobs can be retried';
  end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email address';
  end if;
  -- A fresh job is created for already-sent mails (resend); failed/bounced ones are re-queued in place.
  if j.status = 'sent' then
    insert into public.email_jobs (event_id, certificate_id, to_email, to_name, from_name, reply_to, subject, body, attachment_name)
    values (j.event_id, j.certificate_id, coalesce(v_email, j.to_email), j.to_name, j.from_name, j.reply_to, j.subject, j.body, j.attachment_name);
  else
    update public.email_jobs
       set status = 'queued', attempts = 0, last_error = null, scheduled_at = now(),
           to_email = coalesce(v_email, to_email)
     where id = p_id;
  end if;
  if v_email is not null then
    update public.recipients set email = v_email
     where id = (select recipient_id from public.certificates where id = j.certificate_id);
  end if;
  perform public.log_audit('email.retry', 'email_job', p_id::text, jsonb_build_object('certificate_id', j.certificate_id));
end $$;

create or replace function public.retry_failed_jobs(p_event uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_write_event(p_event) then raise exception 'Not allowed'; end if;
  update public.email_jobs
     set status = 'queued', attempts = 0, last_error = null, scheduled_at = now()
   where event_id = p_event and status = 'failed';
  get diagnostics n = row_count;
  perform public.log_audit('email.retry_failed', 'event', p_event::text, jsonb_build_object('count', n));
  return n;
end $$;

create or replace function public.cancel_queued_jobs(p_event uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_write_event(p_event) then raise exception 'Not allowed'; end if;
  update public.email_jobs set status = 'cancelled' where event_id = p_event and status = 'queued';
  get diagnostics n = row_count;
  perform public.log_audit('email.cancelled', 'event', p_event::text, jsonb_build_object('count', n));
  return n;
end $$;

-- Deletes participant emails + generated PDFs. The certificate record (name, event, issuer, code)
-- stays so the public verify page keeps working. Returns PDF storage paths for the client to remove.
create or replace function public.purge_event_data(p_event uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare paths text[]; v_name text;
begin
  if not public.can_write_event(p_event) then raise exception 'Not allowed'; end if;
  select coalesce(array_agg(pdf_path), '{}') into paths
    from public.certificates where event_id = p_event and pdf_path is not null;
  update public.certificates
     set pdf_path = null, pdf_ready = false, fields_snapshot = '{}'::jsonb, recipient_id = null
   where event_id = p_event;
  delete from public.email_jobs where event_id = p_event;
  delete from public.recipients where event_id = p_event;
  update public.events set status = 'purged', purged_at = now() where id = p_event;
  select name into v_name from public.events where id = p_event;
  perform public.log_audit('event.data_purged', 'event', p_event::text, jsonb_build_object('event', v_name));
  return paths;
end $$;

create or replace function public.event_stats(p_event uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_read_event(p_event) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'recipients', (select count(*) from public.recipients where event_id = p_event),
    'certificates', (select count(*) from public.certificates where event_id = p_event),
    'revoked', (select count(*) from public.certificates where event_id = p_event and status = 'revoked'),
    'jobs', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
               from (select status, count(*) n from public.email_jobs where event_id = p_event group by status) s),
    'views_total', (select count(*) from public.certificate_views v
                      join public.certificates c on c.id = v.certificate_id where c.event_id = p_event),
    'unique_viewed', (select count(distinct v.certificate_id) from public.certificate_views v
                        join public.certificates c on c.id = v.certificate_id where c.event_id = p_event),
    'views_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb)
                       from (select v.viewed_at::date d, count(*) n
                               from public.certificate_views v
                               join public.certificates c on c.id = v.certificate_id
                              where c.event_id = p_event and v.viewed_at > now() - interval '14 days'
                              group by 1) x)
  );
end $$;

create or replace function public.events_overview()
returns table (event_id uuid, recipients bigint, certificates bigint, sent bigint, failed bigint, queued bigint)
language sql stable security invoker set search_path = public as $$
  select e.id,
    (select count(*) from public.recipients r where r.event_id = e.id),
    (select count(*) from public.certificates c where c.event_id = e.id),
    (select count(*) from public.email_jobs j where j.event_id = e.id and j.status = 'sent'),
    (select count(*) from public.email_jobs j where j.event_id = e.id and j.status in ('failed', 'bounced')),
    (select count(*) from public.email_jobs j where j.event_id = e.id and j.status in ('queued', 'sending'))
  from public.events e;
$$;

create or replace function public.get_send_limits()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.app_settings;
begin
  if not public.is_active() then raise exception 'Not allowed'; end if;
  select * into s from public.app_settings where id = 1;
  return jsonb_build_object('daily_cap', s.daily_cap, 'batch_size', s.batch_size, 'sending_enabled', s.sending_enabled);
end $$;

create or replace function public.queue_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.app_settings;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select * into s from public.app_settings where id = 1;
  return jsonb_build_object(
    'queued', (select count(*) from public.email_jobs where status = 'queued'),
    'sending', (select count(*) from public.email_jobs where status = 'sending'),
    'failed', (select count(*) from public.email_jobs where status in ('failed', 'bounced')),
    'sent_24h', (select count(*) from public.email_jobs where status = 'sent' and sent_at > now() - interval '24 hours'),
    'daily_cap', s.daily_cap, 'batch_size', s.batch_size, 'sending_enabled', s.sending_enabled
  );
end $$;

-- PUBLIC: certificate verification. Returns only safe fields, never emails.
create or replace function public.verify_certificate(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_raw text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_code text;
  v_hdr text := coalesce(nullif(current_setting('request.headers', true), ''), '{}');
  v_ip text;
  v_fail int;
  c public.certificates;
begin
  begin
    v_ip := trim(split_part(coalesce((v_hdr::json) ->> 'x-forwarded-for', 'unknown'), ',', 1));
  exception when others then
    v_ip := 'unknown';
  end;

  select count(*) into v_fail from public.verify_failures where ip = v_ip and at > now() - interval '10 minutes';
  if v_fail >= 30 then
    return jsonb_build_object('found', false, 'rate_limited', true);
  end if;

  if length(v_raw) <> 12 then
    insert into public.verify_failures (ip) values (v_ip);
    return jsonb_build_object('found', false);
  end if;
  v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);

  select * into c from public.certificates where verification_code = v_code;
  if not found then
    insert into public.verify_failures (ip) values (v_ip);
    if random() < 0.02 then
      delete from public.verify_failures where at < now() - interval '1 day';
    end if;
    return jsonb_build_object('found', false);
  end if;

  insert into public.certificate_views (certificate_id) values (c.id);
  return jsonb_build_object(
    'found', true,
    'code', c.verification_code,
    'recipient_name', c.recipient_name,
    'event_name', c.event_name,
    'organizer', c.organizer,
    'event_date', c.event_date,
    'issue_date', c.issue_date,
    'issuer_name', c.issuer_name,
    'issuer_department', c.issuer_department,
    'status', c.status,
    'revoked_at', c.revoked_at,
    'revoke_reason', c.revoke_reason
  );
end $$;

-- SERVICE ROLE ONLY: used by the email worker (Edge Function).
create or replace function public.claim_email_jobs(p_limit int)
returns setof public.email_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select j.id
      from public.email_jobs j
      join public.certificates c on c.id = j.certificate_id
      join public.events e on e.id = j.event_id
      join public.profiles p on p.id = e.owner_id
     where j.status = 'queued'
       and j.scheduled_at <= now()
       and c.status = 'issued'
       and c.pdf_ready
       and p.status = 'active'
     order by j.scheduled_at, j.created_at
     limit greatest(p_limit, 0)
       for update of j skip locked
  )
  update public.email_jobs j
     set status = 'sending', locked_at = now(), attempts = j.attempts + 1
    from picked
   where j.id = picked.id
  returning j.*;
end $$;

-- -----------------------------------------------------------------------------
-- 4. TRIGGER: certificate snapshots always come from the database
-- -----------------------------------------------------------------------------

create or replace function public.certificates_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.events; p public.profiles;
begin
  select * into e from public.events where id = new.event_id;
  if not found then raise exception 'Event not found'; end if;
  if e.status = 'purged' then raise exception 'This event has been purged'; end if;
  select * into p from public.profiles where id = e.owner_id;
  new.event_name := e.name;
  new.organizer := e.organizer;
  new.event_date := e.event_date;
  new.issuer_name := p.full_name;
  new.issuer_department := p.department;
  new.verification_code := upper(new.verification_code);
  new.pdf_path := e.id::text || '/' || new.id::text || '.pdf';
  new.pdf_ready := false;
  new.status := 'issued';
  new.revoked_at := null;
  new.revoked_by := null;
  new.revoke_reason := null;
  return new;
end $$;

drop trigger if exists trg_certificates_fill on public.certificates;
create trigger trg_certificates_fill
  before insert on public.certificates
  for each row execute function public.certificates_fill();

-- -----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.events enable row level security;
alter table public.event_templates enable row level security;
alter table public.recipients enable row level security;
alter table public.certificates enable row level security;
alter table public.email_jobs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.certificate_views enable row level security;
alter table public.verify_failures enable row level security;

-- profiles: you see yourself; admin sees and manages everyone. Rows are created by the admin-users function.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- app_settings: admin only
drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.is_admin());
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- events
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using ((owner_id = auth.uid() and public.is_active()) or public.is_admin());
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (owner_id = auth.uid() and public.is_active());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using ((owner_id = auth.uid() and public.is_active()) or public.is_admin())
  with check ((owner_id = auth.uid() and public.is_active()) or public.is_admin());

-- event_templates
drop policy if exists templates_select on public.event_templates;
create policy templates_select on public.event_templates for select to authenticated using (public.can_read_event(event_id));
drop policy if exists templates_insert on public.event_templates;
create policy templates_insert on public.event_templates for insert to authenticated with check (public.can_write_event(event_id));
drop policy if exists templates_update on public.event_templates;
create policy templates_update on public.event_templates for update to authenticated
  using (public.can_write_event(event_id)) with check (public.can_write_event(event_id));

-- recipients
drop policy if exists recipients_select on public.recipients;
create policy recipients_select on public.recipients for select to authenticated using (public.can_read_event(event_id));
drop policy if exists recipients_insert on public.recipients;
create policy recipients_insert on public.recipients for insert to authenticated with check (public.can_write_event(event_id));
drop policy if exists recipients_update on public.recipients;
create policy recipients_update on public.recipients for update to authenticated
  using (public.can_write_event(event_id)) with check (public.can_write_event(event_id));
drop policy if exists recipients_delete on public.recipients;
create policy recipients_delete on public.recipients for delete to authenticated using (public.can_write_event(event_id));

-- certificates: insert only; revoke/reissue/pdf-ready go through RPCs
drop policy if exists certificates_select on public.certificates;
create policy certificates_select on public.certificates for select to authenticated using (public.can_read_event(event_id));
drop policy if exists certificates_insert on public.certificates;
create policy certificates_insert on public.certificates for insert to authenticated with check (public.can_write_event(event_id));

-- email_jobs: insert only; retry/cancel go through RPCs; the worker uses the service role
drop policy if exists jobs_select on public.email_jobs;
create policy jobs_select on public.email_jobs for select to authenticated using (public.can_read_event(event_id));
drop policy if exists jobs_insert on public.email_jobs;
create policy jobs_insert on public.email_jobs for insert to authenticated
  with check (
    public.can_write_event(event_id)
    and exists (select 1 from public.certificates c
                 where c.id = certificate_id and c.event_id = email_jobs.event_id
                   and c.status = 'issued' and c.pdf_ready)
  );

-- audit_logs: admin reads all, everyone reads their own; writes only via log_audit()
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_admin() or actor_id = auth.uid());

-- certificate_views / verify_failures: no policies = no direct access (RPC only)

-- -----------------------------------------------------------------------------
-- 6. FUNCTION PERMISSIONS
-- -----------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.is_admin()', 'public.is_active()', 'public.owns_event(uuid)',
    'public.can_read_event(uuid)', 'public.can_write_event(uuid)',
    'public.log_audit(text,text,text,jsonb)', 'public.complete_password_change()',
    'public.revoke_certificate(uuid,text)', 'public.reinstate_certificate(uuid)',
    'public.reissue_certificate(uuid,text)', 'public.mark_pdfs_ready(uuid[])',
    'public.retry_job(uuid,text)', 'public.retry_failed_jobs(uuid)', 'public.cancel_queued_jobs(uuid)',
    'public.purge_event_data(uuid)', 'public.event_stats(uuid)', 'public.events_overview()',
    'public.get_send_limits()', 'public.queue_overview()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

revoke all on function public.claim_email_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_email_jobs(int) to service_role;

-- -----------------------------------------------------------------------------
-- 7. STORAGE
--   event-assets : public  (template backgrounds, logos, signatures)
--   certificates : private (generated PDFs; downloaded through signed URLs)
-- Files live under  <event_id>/<filename>
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('event-assets', 'event-assets', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('certificates', 'certificates', false)
  on conflict (id) do nothing;

drop policy if exists "assets insert" on storage.objects;
create policy "assets insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-assets' and public.can_write_event(public.event_from_path(name)));
drop policy if exists "assets update" on storage.objects;
create policy "assets update" on storage.objects for update to authenticated
  using (bucket_id = 'event-assets' and public.can_write_event(public.event_from_path(name)));
drop policy if exists "assets delete" on storage.objects;
create policy "assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-assets' and public.can_write_event(public.event_from_path(name)));

drop policy if exists "certs select" on storage.objects;
create policy "certs select" on storage.objects for select to authenticated
  using (bucket_id = 'certificates' and public.can_read_event(public.event_from_path(name)));
drop policy if exists "certs insert" on storage.objects;
create policy "certs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'certificates' and public.can_write_event(public.event_from_path(name)));
drop policy if exists "certs update" on storage.objects;
create policy "certs update" on storage.objects for update to authenticated
  using (bucket_id = 'certificates' and public.can_write_event(public.event_from_path(name)));
drop policy if exists "certs delete" on storage.objects;
create policy "certs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'certificates' and public.can_write_event(public.event_from_path(name)));
