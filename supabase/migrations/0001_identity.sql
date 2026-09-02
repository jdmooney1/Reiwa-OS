-- ============================================================================
-- 0001 — Identity, tenancy & the Supabase-native RLS helper layer
-- ----------------------------------------------------------------------------
-- Credentials live in Supabase Auth (auth.users); this schema stores the staff
-- profile + tenancy. RLS derives the caller's identity from auth.uid() (the
-- verified JWT `sub` claim in request.jwt.claims) and derives role/org scope
-- from the database itself via SECURITY DEFINER helpers — nothing
-- authorization-relevant is trusted from the client.
--
-- The app server connects with the privileged DATABASE_URL (transaction
-- pooler) and, per request, runs inside a transaction:
--     set local role authenticated;
--     select set_config('request.jwt.claims', '<claims json>', true);
-- which is exactly the execution context Supabase's own stack (PostgREST)
-- gives queries — so these policies behave identically on hosted Supabase.
-- ============================================================================

create schema if not exists app;

-- On Supabase `authenticated` exists; create it on plain Postgres (dev/test).
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- Let the privileged migration/runtime user assume the authenticated role
-- (`set local role authenticated`). No-op where already granted or superuser.
do $$ begin
  execute format('grant authenticated to %I', current_user);
exception when others then null;
end $$;

-- ---- Identity & tenancy tables ---------------------------------------------
create table if not exists organizations (
  org_id     uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null default 'corporate',
  created_at timestamptz not null default now()
);

-- Staff profile — 1:1 with a Supabase Auth user; no credentials stored here.
create table if not exists users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  global_role text not null default 'org_user'
               check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer')),
  created_at  timestamptz not null default now()
);

create table if not exists organization_members (
  org_id  uuid not null references organizations(org_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  role    text not null default 'viewer' check (role in ('owner', 'manager', 'analyst', 'viewer')),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on organization_members(user_id);

-- ---- Request-context helpers -----------------------------------------------
-- SECURITY DEFINER so they read users/organization_members as the table owner
-- (bypassing RLS on those lookups — the standard Supabase pattern that also
-- avoids policy recursion). search_path is pinned; identity comes only from
-- auth.uid(), i.e. the verified JWT.
create or replace function app.current_user_id() returns uuid
  language sql stable as $$ select auth.uid() $$;

create or replace function app.current_global_role() returns text
  language sql stable security definer set search_path = public, auth as $$
    select coalesce(
      (select global_role from users where user_id = auth.uid()),
      'anon')
  $$;

create or replace function app.is_admin() returns boolean
  language sql stable as $$ select app.current_global_role() = 'reiwa_admin' $$;

create or replace function app.can_write() returns boolean
  language sql stable as $$
    select app.current_global_role() in ('reiwa_admin', 'org_user')
  $$;

create or replace function app.current_org_ids() returns uuid[]
  language sql stable security definer set search_path = public, auth as $$
    select coalesce(
      (select array_agg(org_id) from organization_members where user_id = auth.uid()),
      array[]::uuid[])
  $$;

-- The single predicate every tenant policy uses.
create or replace function app.has_org(target uuid) returns boolean
  language sql stable as $$ select app.is_admin() or target = any (app.current_org_ids()) $$;

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

-- Users: a user may read only themselves (admins read all). Profile writes go
-- through the privileged connection (bypasses RLS as table owner).
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
