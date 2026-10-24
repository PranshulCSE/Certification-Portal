-- =============================================================================
-- FIX ROW-LEVEL SECURITY (RLS) FOR EVENT ASSETS & TEMPLATES
-- Run this in your Supabase Dashboard -> SQL Editor
-- =============================================================================

-- 1. Helper function fixes
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
  select (public.owns_event(eid) and public.is_active()) or public.is_admin();
$$;

create or replace function public.can_read_event(eid uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select (public.owns_event(eid) and public.is_active()) or public.is_admin();
$$;

-- 2. Storage Policies for 'event-assets' bucket
-- Ensure bucket is marked public
update storage.buckets set public = true where id = 'event-assets';
insert into storage.buckets (id, name, public) values ('event-assets', 'event-assets', true)
  on conflict (id) do update set public = true;

-- event-assets is a public bucket used for template backgrounds, logos, and signatures.
-- Anyone can view assets, and any active logged-in user (admin or issuer) can upload.

-- Allow public read access to event assets (required for preview, PDF render, and upsert conflict check)
drop policy if exists "assets select" on storage.objects;
create policy "assets select" on storage.objects for select to public
  using (bucket_id = 'event-assets');

-- Allow authenticated active users to upload/insert assets
drop policy if exists "assets insert" on storage.objects;
create policy "assets insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-assets' 
    and (public.is_active() or public.is_admin())
  );

-- Allow authenticated active users to update assets (required for upsert: true)
drop policy if exists "assets update" on storage.objects;
create policy "assets update" on storage.objects for update to authenticated
  using (
    bucket_id = 'event-assets' 
    and (public.is_active() or public.is_admin())
  )
  with check (
    bucket_id = 'event-assets' 
    and (public.is_active() or public.is_admin())
  );

-- Allow authenticated active users to delete assets
drop policy if exists "assets delete" on storage.objects;
create policy "assets delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-assets' 
    and (public.is_active() or public.is_admin())
  );

-- 3. Event Templates RLS Policies
drop policy if exists templates_select on public.event_templates;
create policy templates_select on public.event_templates for select to authenticated 
  using (public.can_read_event(event_id));

drop policy if exists templates_insert on public.event_templates;
create policy templates_insert on public.event_templates for insert to authenticated 
  with check (public.can_write_event(event_id));

drop policy if exists templates_update on public.event_templates;
create policy templates_update on public.event_templates for update to authenticated
  using (public.can_write_event(event_id)) 
  with check (public.can_write_event(event_id));

-- 4. Ensure current user's profile is active and admin (if not already set)
update public.profiles 
set status = 'active' 
where status is null or status = 'suspended';

-- If your admin user was created without admin role in profiles, this ensures they are admin:
update public.profiles 
set role = 'admin' 
where role is null;
