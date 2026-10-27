-- =============================================================================
-- MIGRATION 003: GLOBAL STORE (REUSABLE LOGOS & SIGNATURES)
-- Run this in your Supabase Dashboard -> SQL Editor
-- This allows admins to upload official logos and signatures once, which can be
-- reused across all certificate templates by all issuers, eliminating duplicate
-- storage and maintaining university branding consistency.
-- =============================================================================

create table if not exists public.global_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('logo', 'signature', 'other')),
  path text not null unique,
  width int,
  height int,
  file_size int,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb, -- e.g. {"signer_name": "...", "signer_title": "..."}
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_global_assets_category on public.global_assets (category);
create index if not exists idx_global_assets_created_at on public.global_assets (created_at desc);

-- Enable Row Level Security
alter table public.global_assets enable row level security;

-- Authenticated users (both admins and issuers) can view all global assets
drop policy if exists "global_assets_select" on public.global_assets;
create policy "global_assets_select" on public.global_assets
  for select to authenticated using (true);

-- Allow public read as well so certificate rendering works without auth restrictions
drop policy if exists "global_assets_public_select" on public.global_assets;
create policy "global_assets_public_select" on public.global_assets
  for select to anon using (true);

-- Admins can insert, update, and delete global assets
drop policy if exists "global_assets_insert" on public.global_assets;
create policy "global_assets_insert" on public.global_assets
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "global_assets_update" on public.global_assets;
create policy "global_assets_update" on public.global_assets
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "global_assets_delete" on public.global_assets;
create policy "global_assets_delete" on public.global_assets
  for delete to authenticated
  using (public.is_admin());

-- Ensure storage policies on 'event-assets' allow global/ path
-- (Already covered by public bucket policies in 002, but repeated here for safety)
insert into storage.buckets (id, name, public) values ('event-assets', 'event-assets', true)
  on conflict (id) do update set public = true;
