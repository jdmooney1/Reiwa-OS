-- ============================================================================
-- 0001 — Identity, tenancy & the portable RLS helper layer
-- ----------------------------------------------------------------------------
-- Runs on PGlite (dev) and Supabase (prod) unchanged. Security is enforced at
-- the database via RLS + the `authenticated` role — never in the frontend.
--
-- Request context is carried in transaction-local GUCs, set per request from the
-- verified session (see src/lib/db/client.ts). On Supabase the SAME helper
-- functions can instead read auth.jwt() claims — only the helper bodies change,
-- not the policies. That indirection is the portability seam.
-- ============================================================================

-- gen_random_uuid() is core in Postgres 13+ (no pgcrypto extension required).
create schema if not exists app;

-- The client role that RLS applies to (Supabase parity).
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ---- Request-context helpers (the portability seam) ------------------------
create or replace function app.current_user_id() returns text
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function app.current_global_role() returns text
  language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'anon') $$;

create or replace function app.is_admin() returns boolean
  language sql stable as $$ select app.current_global_role() = 'reiwa_admin' $$;

create or replace function app.can_write() returns boolean
  language sql stable as $$ select coalesce(nullif(current_setting('app.can_write', true), ''), 'false') = 'true' $$;

create or replace function app.current_org_ids() returns uuid[]
  language sql stable as $$
    select case
      when coalesce(nullif(current_setting('app.org_ids', true), ''), '') = '' then array[]::uuid[]
      else string_to_array(current_setting('app.org_ids', true), ',')::uuid[]
    end
  $$;

-- The single predicate every tenant policy uses.
create or replace function app.has_org(target uuid) returns boolean
  language sql stable as $$ select app.is_admin() or target = any (app.current_org_ids()) $$;

-- ---- Identity & tenancy tables ---------------------------------------------
create table if not exists organizations (
  org_id     uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null default 'corporate',
  created_at timestamptz not null default now()
);

-- App users (self-contained auth; Clerk can replace this later behind the seam).
create table if not exists users (
  user_id       uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text,
  global_role   text not null default 'org_user'
                 check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer')),
  created_at    timestamptz not null default now()
);

create table if not exists organization_members (
  org_id  uuid not null references organizations(org_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  role    text not null default 'viewer' check (role in ('owner', 'manager', 'analyst', 'viewer')),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on organization_members(user_id);

-- ---- RLS -------------------------------------------------------------------
alter table organizations        enable row level security;
alter table users                enable row level security;
alter table organization_members enable row level security;

-- Organizations: members (and admins) may read; writes require write scope.
drop policy if exists orgs_select on organizations;
create policy orgs_select on organizations for select to authenticated
  using (app.has_org(org_id));
drop policy if exists orgs_write on organizations;
create policy orgs_write on organizations for all to authenticated
  using (app.has_org(org_id) and app.can_write())
  with check (app.has_org(org_id) and app.can_write());

-- Users: a user may read only themselves (admins read all). Auth flows use the
-- service (superuser) connection, which bypasses RLS.
drop policy if exists users_self on users;
create policy users_self on users for select to authenticated
  using (app.is_admin() or user_id::text = app.current_user_id());

drop policy if exists members_select on organization_members;
create policy members_select on organization_members for select to authenticated
  using (app.has_org(org_id));

-- ---- Grants (RLS still gates rows) -----------------------------------------
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
grant select, insert, update, delete on organizations, organization_members to authenticated;
grant select on users to authenticated;
