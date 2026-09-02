-- ============================================================================
-- AUTH SHIM — DEV/TEST ONLY. NEVER APPLIED TO SUPABASE.
-- ----------------------------------------------------------------------------
-- On hosted Supabase the `auth` schema, auth.users, auth.uid() and auth.jwt()
-- are provided by the platform. This shim recreates the minimal surface so the
-- SAME Supabase-native migrations and RLS policies run on the transitional
-- embedded-Postgres (PGlite) runtime and on the ephemeral test databases.
-- The bootstrap applies it ONLY when the `auth` schema is absent.
-- This file lives outside supabase/migrations so the Supabase CLI never sees it.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key,
  email      text unique,
  created_at timestamptz not null default now()
);

-- Identical semantics to Supabase: read the sub claim of request.jwt.claims.
create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub'
      ), ''
    )::uuid
  $$;

create or replace function auth.jwt() returns jsonb
  language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
