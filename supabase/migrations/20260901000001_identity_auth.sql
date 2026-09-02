-- ============================================================================
-- 20260901000001 — Identity, tenancy & the Supabase-native RLS helper layer
-- ----------------------------------------------------------------------------
-- Supabase Auth is the single identity provider. Identity reaches RLS as the
-- JWT `sub` claim: policies call auth.uid() (provided by Supabase; by the dev
-- shim on the transitional embedded runtime). Authorisation derives from
-- DATABASE JOINS on membership tables via SECURITY DEFINER helpers — never
-- from client-supplied claims.
--
-- Access modes (see src/lib/db/client.ts):
--   * withSession → BEGIN; SET LOCAL ROLE authenticated;
--                   SET LOCAL request.jwt.claims = '{"sub":"<auth uid>"}';
--                   → every query is RLS-gated; auth.uid() = that sub.
--   * adminQuery  → runs as the DATABASE_URL role (table owner). Owners bypass
--                   non-FORCE RLS: used for migrations, seeding and identity
--                   resolution. This is a DIRECT DATABASE privilege, distinct
--                   from SUPABASE_SECRET_KEY (a server-only Supabase API
--                   credential used for Auth Admin operations).
-- ============================================================================

-- The client role RLS applies to (exists on Supabase; created for dev shim).
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists app;

-- ---- Identity & tenancy tables ---------------------------------------------
create table if not exists organizations (
  org_id     uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null default 'corporate',
  created_at timestamptz not null default now()
);

-- Staff profiles. user_id IS the Supabase Auth user id (auth.users.id).
-- password_hash is TRANSITIONAL: used only by the legacy dev sign-in until
-- Supabase Auth is live; dropped at P0 step 12.
create table if not exists users (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  name          text,
  global_role   text not null default 'org_user'
                 check (global_role in ('reiwa_admin', 'org_user')),
  password_hash text,
  created_at    timestamptz not null default now()
);

create table if not exists organization_members (
  org_id  uuid not null references organizations(org_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  role    text not null default 'viewer' check (role in ('owner', 'manager', 'analyst', 'viewer')),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on organization_members(user_id);

-- ---- Authorisation helpers (SECURITY DEFINER: owner bypasses RLS, so these
-- membership lookups cannot recurse into the policies that call them) --------
create or replace function app.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from public.users u
      where u.user_id = auth.uid() and u.global_role = 'reiwa_admin'
    )
  $$;

create or replace function app.is_staff() returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (select 1 from public.users u where u.user_id = auth.uid())
  $$;

create or replace function app.has_org(target uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select app.is_admin() or exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid() and m.org_id = target
    )
  $$;

-- Write scope: admin, or membership role that carries write permission.
create or replace function app.can_write_org(target uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select app.is_admin() or exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid() and m.org_id = target
        and m.role in ('owner', 'manager', 'analyst')
    )
  $$;

-- ---- RLS -------------------------------------------------------------------
alter table organizations        enable row level security;
alter table users                enable row level security;
alter table organization_members enable row level security;

drop policy if exists orgs_select on organizations;
create policy orgs_select on organizations for select to authenticated
  using (app.has_org(org_id));
drop policy if exists orgs_write on organizations;
create policy orgs_write on organizations for all to authenticated
  using (app.has_org(org_id) and app.can_write_org(org_id))
  with check (app.has_org(org_id) and app.can_write_org(org_id));

-- Users: self or admin. Auth flows resolve identity via adminQuery.
drop policy if exists users_self on users;
create policy users_self on users for select to authenticated
  using (app.is_admin() or user_id = auth.uid());

drop policy if exists members_select on organization_members;
create policy members_select on organization_members for select to authenticated
  using (app.has_org(org_id));

-- ---- Grants (RLS still gates rows) -----------------------------------------
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
grant select, insert, update, delete on organizations, organization_members to authenticated;
grant select on users to authenticated;
