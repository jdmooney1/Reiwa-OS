-- ============================================================================
-- 0001 — Identity, tenancy & the Supabase-native RLS context layer
-- ----------------------------------------------------------------------------
-- Runs on hosted Supabase PostgreSQL. Security is enforced at the database via
-- RLS + Supabase's `authenticated` role — never in the frontend.
--
-- Identity is owned by Supabase Auth (`auth.users`). `profiles` carries the
-- application-level attributes (display name, global role) keyed 1:1 to the
-- Supabase user id.
--
-- Request context is carried in the standard Supabase claims GUC
-- `request.jwt.claims`, set transaction-locally by withSession()
-- (see src/lib/db/client.ts). The RLS helpers below read it through Supabase's
-- own `auth.jwt()` / `auth.uid()`, so the same policies hold whether a statement
-- arrives over a direct Postgres connection or through PostgREST.
-- ============================================================================

create schema if not exists app;

-- Supabase provisions `anon`, `authenticated` and `service_role`. Fail loudly
-- rather than silently creating a divergent local role.
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    raise exception 'Role "authenticated" is missing — this migration targets a Supabase database';
  end if;
end $$;

-- ---- Request-context helpers (read Supabase claims) ------------------------
-- All helpers are STABLE, SECURITY INVOKER and run with an empty search_path so
-- they cannot be captured by a caller-controlled schema.

create or replace function app.current_user_id() returns text
  language sql stable
  set search_path = ''
  as $$ select nullif(auth.jwt() ->> 'sub', '') $$;

create or replace function app.current_global_role() returns text
  language sql stable
  set search_path = ''
  as $$
    select coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'global_role', ''), 'anon')
  $$;

create or replace function app.is_admin() returns boolean
  language sql stable
  set search_path = ''
  as $$ select app.current_global_role() = 'reiwa_admin' $$;

create or replace function app.can_write() returns boolean
  language sql stable
  set search_path = ''
  as $$
    select coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'can_write', ''), 'false') = 'true'
  $$;

create or replace function app.current_org_ids() returns uuid[]
  language sql stable
  set search_path = ''
  as $$
    select coalesce(
      (select array_agg(value::uuid)
         from jsonb_array_elements_text(
           case jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'org_ids')
             when 'array' then auth.jwt() -> 'app_metadata' -> 'org_ids'
             else '[]'::jsonb
           end) as t(value)),
      array[]::uuid[])
  $$;

-- The single predicate every tenant policy uses.
create or replace function app.has_org(target uuid) returns boolean
  language sql stable
  set search_path = ''
  as $$ select app.is_admin() or target = any (app.current_org_ids()) $$;

-- ---- Identity & tenancy tables ---------------------------------------------
create table if not exists organizations (
  org_id     uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null default 'corporate',
  created_at timestamptz not null default now()
);

-- Application profile for a Supabase Auth user. Credentials live in auth.users
-- and are never mirrored here.
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  global_role text not null default 'org_user'
               check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer')),
  created_at  timestamptz not null default now()
);

create table if not exists organization_members (
  org_id  uuid not null references organizations(org_id) on delete cascade,
  user_id uuid not null references profiles(user_id) on delete cascade,
  role    text not null default 'viewer' check (role in ('owner', 'manager', 'analyst', 'viewer')),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on organization_members(user_id);

-- ---- RLS -------------------------------------------------------------------
alter table organizations        enable row level security;
alter table profiles             enable row level security;
alter table organization_members enable row level security;

-- Organizations: members (and admins) may read; writes require write scope.
drop policy if exists orgs_select on organizations;
create policy orgs_select on organizations for select to authenticated
  using (app.has_org(org_id));
drop policy if exists orgs_write on organizations;
create policy orgs_write on organizations for all to authenticated
  using (app.has_org(org_id) and app.can_write())
  with check (app.has_org(org_id) and app.can_write());

-- Profiles: a user may read only themselves (admins read all). Sign-in and
-- session assembly use the privileged connection, which bypasses RLS.
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select to authenticated
  using (app.is_admin() or user_id::text = app.current_user_id());

drop policy if exists members_select on organization_members;
create policy members_select on organization_members for select to authenticated
  using (app.has_org(org_id));

-- ---- Grants (RLS still gates rows) -----------------------------------------
-- EXECUTE is enumerated, never blanket: `grant ... on all functions` would hand
-- `authenticated` every helper in the schema, including ones it has no business
-- calling, and would silently do the same for anything added later. Each grant
-- below names a function the `authenticated` role genuinely needs — these six
-- are evaluated inside the RLS policies above (directly, or from another
-- SECURITY INVOKER helper's body, which runs as the calling role).
--
-- The trigger functions in later migrations are deliberately NOT granted:
-- PostgreSQL checks EXECUTE on a trigger function when the trigger is created,
-- not when it fires.
revoke execute on all functions in schema app from public;

grant usage on schema app to authenticated;
grant execute on function
  app.current_user_id(),
  app.current_global_role(),
  app.current_org_ids(),
  app.is_admin(),
  app.can_write(),
  app.has_org(uuid)
  to authenticated;

grant select, insert, update, delete on organizations, organization_members to authenticated;
grant select on profiles to authenticated;
