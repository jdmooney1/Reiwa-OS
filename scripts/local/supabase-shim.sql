-- ============================================================================
-- Supabase shim for LOCAL MIGRATION VALIDATION ONLY.
-- ----------------------------------------------------------------------------
-- Recreates the parts of a hosted Supabase database that the migrations depend
-- on but do not create themselves: the `anon` / `authenticated` / `service_role`
-- roles, the `auth` schema, and auth.uid() / auth.jwt() reading the standard
-- claims GUC.
--
-- This file is NEVER applied to a real environment: supabase/migrations is the
-- production chain, and hosted Supabase provides all of this already. It exists
-- so `npm run db:verify` can prove the migration chain applies cleanly, and
-- prove the RLS policies actually deny, without network access to Supabase.
-- ============================================================================

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;

-- Supabase's auth.users. Only the columns the migrations reference.
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- The standard Supabase claim accessors, reading the transaction-local GUC that
-- src/lib/db/client.ts sets. Identical semantics to the hosted versions for
-- everything these migrations rely on.
create or replace function auth.jwt() returns jsonb
  language sql stable
  set search_path = ''
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb)
  $fn$;

create or replace function auth.uid() returns uuid
  language sql stable
  set search_path = ''
  as $fn$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $fn$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Supabase grants `anon` rights on new public tables by default; reproduce that
-- so the migrations' `revoke ... from anon` statements are actually meaningful
-- when verified locally.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
