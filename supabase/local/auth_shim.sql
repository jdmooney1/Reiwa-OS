-- ============================================================================
-- LOCAL-ONLY Supabase auth shim (never applied to a real Supabase project).
-- ----------------------------------------------------------------------------
-- Recreates the minimal surface of Supabase's managed `auth` schema so the SAME
-- migrations and RLS policies run on a plain Postgres (dev/test):
--   * auth.users            — subset of GoTrue's table (id/email/password)
--   * auth.uid() / jwt()    — identical definitions to Supabase's built-ins
--                             (read the request.jwt.claims GUC)
-- The migration runner applies this file ONLY when the `auth` schema is absent,
-- which is never the case on hosted Supabase.
-- ============================================================================
create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  aud                text default 'authenticated',
  role               text default 'authenticated',
  email_confirmed_at timestamptz default now(),
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Mirrors supabase/auth's auth.jwt(): the claims set for the current request.
create or replace function auth.jwt() returns jsonb
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;

-- Mirrors supabase/auth's auth.uid(): the `sub` claim as a uuid.
create or replace function auth.uid() returns uuid
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;

create or replace function auth.role() returns text
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
  $$;

-- Marker so seeding knows credentials live in this shim, not in hosted GoTrue.
create or replace function auth.is_local_shim() returns boolean
  language sql immutable as $$ select true $$;

grant usage on schema auth to public;
grant execute on function auth.jwt(), auth.uid(), auth.role() to public;
