-- =============================================================================
-- MIGRATION 004: FIX GLOBAL STORE DELETION & RLS PERMISSIONS
-- Run this in your Supabase Dashboard -> SQL Editor
-- This fixes the issue where deleting signatures/logos from the Global Store
-- fails silently due to restrictive RLS policies and storage path checks.
-- =============================================================================

-- 1. Ensure global_assets table exists
create table if not exists public.global_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('logo', 'signature', 'other')),
  path text not null unique,
  width int,
  height int,
  file_size int,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_global_assets_category on public.global_assets (category);
create index if not exists idx_global_assets_created_at on public.global_assets (created_at desc);

-- 2. Enable Row Level Security and set permissive policies for authenticated users
alter table public.global_assets enable row level security;

drop policy if exists "global_assets_select" on public.global_assets;
create policy "global_assets_select" on public.global_assets
  for select to authenticated using (true);

drop policy if exists "global_assets_public_select" on public.global_assets;
create policy "global_assets_public_select" on public.global_assets
  for select to anon using (true);

drop policy if exists "global_assets_insert" on public.global_assets;
create policy "global_assets_insert" on public.global_assets
  for insert to authenticated with check (true);

drop policy if exists "global_assets_update" on public.global_assets;
create policy "global_assets_update" on public.global_assets
  for update to authenticated using (true) with check (true);

drop policy if exists "global_assets_delete" on public.global_assets;
create policy "global_assets_delete" on public.global_assets
  for delete to authenticated using (true);

-- 3. Storage Bucket policies for 'event-assets'
-- Ensure bucket is public
insert into storage.buckets (id, name, public) values ('event-assets', 'event-assets', true)
  on conflict (id) do update set public = true;

-- Allow reading, inserting, updating, and deleting files under event-assets (including global/ prefix)
drop policy if exists "assets select" on storage.objects;
create policy "assets select" on storage.objects for select to public
  using (bucket_id = 'event-assets');

drop policy if exists "assets insert" on storage.objects;
create policy "assets insert" on storage.objects for insert to public
  with check (bucket_id = 'event-assets');

drop policy if exists "assets update" on storage.objects;
create policy "assets update" on storage.objects for update to public
  using (bucket_id = 'event-assets') with check (bucket_id = 'event-assets');

drop policy if exists "assets delete" on storage.objects;
create policy "assets delete" on storage.objects for delete to public
  using (bucket_id = 'event-assets');
