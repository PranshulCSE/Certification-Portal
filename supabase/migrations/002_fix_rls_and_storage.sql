-- =============================================================================
-- FIX ROW-LEVEL SECURITY (RLS) FOR EVENT ASSETS & TEMPLATES
-- Run this in your Supabase Dashboard -> SQL Editor
-- =============================================================================

-- 1. Ensure all auth users exist in public.profiles as active admin
insert into public.profiles (id, email, full_name, role, status)
select 
  id, 
  email, 
  coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1), 'Admin'),
  'admin',
  'active'
from auth.users
on conflict (id) do update 
  set status = 'active', 
      role = coalesce(public.profiles.role, 'admin');

-- Auto-create/sync profile whenever a user signs up in Supabase Auth
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'User'),
    'admin',
    'active'
  )
  on conflict (id) do update set status = 'active';
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 2. Helper function fixes
create or replace function public.event_from_path(p text)
returns uuid language plpgsql immutable security definer set search_path = public as $$
declare
  clean_p text;
  first_segment text;
begin
  clean_p := trim(both '/' from p);
  first_segment := split_part(clean_p, '/', 1);
  return first_segment::uuid;
exception when others then
  return null;
end $$;

create or replace function public.can_write_event(eid uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select true;
$$;

create or replace function public.can_read_event(eid uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select true;
$$;

-- 3. Storage Policies for 'event-assets' bucket
-- Ensure bucket is marked public
update storage.buckets set public = true where id = 'event-assets';
insert into storage.buckets (id, name, public) values ('event-assets', 'event-assets', true)
  on conflict (id) do update set public = true;

-- Allow public read access to event assets (required for preview, PDF render, and upsert conflict check)
drop policy if exists "assets select" on storage.objects;
create policy "assets select" on storage.objects for select to public
  using (bucket_id = 'event-assets');

-- Allow authenticated users to upload/insert assets
drop policy if exists "assets insert" on storage.objects;
create policy "assets insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-assets');

-- Allow authenticated users to update assets (required for upsert: true)
drop policy if exists "assets update" on storage.objects;
create policy "assets update" on storage.objects for update to authenticated
  using (bucket_id = 'event-assets')
  with check (bucket_id = 'event-assets');

-- Allow authenticated users to delete assets
drop policy if exists "assets delete" on storage.objects;
create policy "assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-assets');

-- Certificates bucket storage policies
insert into storage.buckets (id, name, public) values ('certificates', 'certificates', false)
  on conflict (id) do nothing;

drop policy if exists "certs select" on storage.objects;
create policy "certs select" on storage.objects for select to authenticated
  using (bucket_id = 'certificates');

drop policy if exists "certs insert" on storage.objects;
create policy "certs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'certificates');

drop policy if exists "certs update" on storage.objects;
create policy "certs update" on storage.objects for update to authenticated
  using (bucket_id = 'certificates')
  with check (bucket_id = 'certificates');

drop policy if exists "certs delete" on storage.objects;
create policy "certs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'certificates');

-- 4. Event Templates RLS Policies
drop policy if exists templates_select on public.event_templates;
create policy templates_select on public.event_templates for select to authenticated 
  using (true);

drop policy if exists templates_insert on public.event_templates;
create policy templates_insert on public.event_templates for insert to authenticated 
  with check (true);

drop policy if exists templates_update on public.event_templates;
create policy templates_update on public.event_templates for update to authenticated
  using (true) 
  with check (true);
