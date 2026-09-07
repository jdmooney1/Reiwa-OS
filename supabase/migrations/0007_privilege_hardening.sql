-- ============================================================================
-- 0007 — Privilege hardening (P6)
-- ----------------------------------------------------------------------------
-- An audit of the live Supabase catalogue found three things that RLS was
-- covering for but which should never have been granted in the first place:
--
--   1. `anon` — the role an UNAUTHENTICATED request arrives on — held
--      SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on
--      every table migrations 0001-0004 created. RLS denied those requests, so
--      nothing leaked; but a single table shipped one day without RLS, or one
--      permissive policy written `to public`, would have been immediately
--      writable by anybody holding the publishable key. That is one mistake
--      away from a breach, and the privilege was never needed.
--
--   2. `authenticated` held TRUNCATE, REFERENCES and TRIGGER everywhere.
--      TRUNCATE is not filtered by row level security at all: a policy cannot
--      stop it, so the privilege alone would let any signed-in session empty a
--      table. The application issues no TRUNCATE, defines no foreign key from a
--      user session and creates no trigger, so all three go.
--
--   3. Supabase's stock ALTER DEFAULT PRIVILEGES re-granted all of the above to
--      `anon` on every table a later migration creates. Fixing today's
--      catalogue without fixing the default would simply re-introduce the
--      problem with the next table.
--
-- Migration 0005 had already done this for the eleven investor tables it
-- created. This migration applies the same rule to everything, and makes the
-- default fail closed so it stays applied.
--
-- Row level security is unchanged and remains the control that decides rows.
-- Privileges decide only what a role may attempt at all; the two are layered,
-- and nothing here relaxes either.
-- ============================================================================

-- ============================================================================
-- 1. Future objects: stop handing new tables to anon
-- ----------------------------------------------------------------------------
-- The grantor is whoever runs the migrations (the `postgres` role on Supabase).
-- Default privileges are recorded per grantor, so this is applied for the
-- current user and, when they differ, for `postgres` as well.
--
-- `authenticated` is included deliberately. Every table this application uses
-- is granted to it by name, in the migration that creates it, so losing the
-- blanket default costs nothing and means a future table is unreachable until
-- somebody decides what it should expose — a migration that forgets a grant
-- fails loudly instead of quietly publishing a table.
--
-- `service_role` is left as Supabase configures it: it is the BYPASSRLS role
-- behind the secret key, equivalent to an administrator, and Supabase's own
-- tooling expects it.
-- ============================================================================
do $$
declare
  grantor text;
  grantors text[] := array[current_user];
begin
  if current_user <> 'postgres' and exists (select from pg_roles where rolname = 'postgres') then
    grantors := grantors || 'postgres';
  end if;
  foreach grantor in array grantors loop
    execute format(
      'alter default privileges for role %I in schema public revoke all on tables from anon, authenticated, public',
      grantor);
    execute format(
      'alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated, public',
      grantor);
    execute format(
      'alter default privileges for role %I in schema public revoke all on functions from anon, authenticated, public',
      grantor);
  end loop;
end $$;

-- ============================================================================
-- 2. Existing objects: take back what was never needed
-- ----------------------------------------------------------------------------
-- Tables and views alike. `anon` and PUBLIC lose everything; `authenticated`
-- loses only TRUNCATE, REFERENCES and TRIGGER, so the SELECT/INSERT/UPDATE/
-- DELETE each earlier migration granted by name is preserved exactly.
-- ============================================================================
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')   -- table, partitioned, view, matview
  loop
    execute format('revoke all on public.%I from anon', r.relname);
    execute format('revoke all on public.%I from public', r.relname);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', r.relname);
  end loop;
end $$;

-- Sequences: `anon` has no reason to hold one either. `authenticated` never
-- calls nextval() directly — every key is a uuid default — but the grant is
-- harmless where a serial exists, so only anon and PUBLIC are stripped.
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from anon, public', r.relname);
  end loop;
end $$;

-- ============================================================================
-- 3. `investor_activity_events` is append-only, for everybody
-- ----------------------------------------------------------------------------
-- The activity trail is the record of what an investor was shown and what they
-- did with it. Migration 0005 already made it append-only for investors: they
-- hold an INSERT policy for their own rows and a SELECT policy for their own
-- rows, and no UPDATE or DELETE policy exists.
--
-- The admin policy, though, was written `for all` in the same loop as the other
-- ten investor tables, which let staff rewrite or erase history. An audit trail
-- a reader can edit is not an audit trail. Staff now hold SELECT and nothing
-- else, and the privilege is withdrawn underneath the policy as well, so the
-- statement is refused whether or not a future policy is added by mistake.
--
-- Retention and erasure remain possible — they are a deliberate operational act
-- on the privileged connection (see docs/17-operations-runbook.md), not
-- something a signed-in session can do.
-- ============================================================================
drop policy if exists investor_activity_events_admin on investor_activity_events;

create policy investor_activity_events_admin_select on investor_activity_events
  for select to authenticated
  using (app.is_admin());

-- Belt and braces: no policy can re-enable what the role cannot do.
revoke update, delete, truncate, references, trigger
  on investor_activity_events from authenticated;

-- ============================================================================
-- 4. Function hardening
-- ----------------------------------------------------------------------------
-- Every SECURITY DEFINER function in `app` already pins an empty search_path
-- (0005). The five trigger functions from 0002/0003 did not: they are SECURITY
-- INVOKER, so the risk is smaller, but a function whose search_path is resolved
-- from the caller's session is a function whose meaning the caller can change.
-- Pin them too, so every function in the schema is unambiguous.
--
-- `set search_path = ''` requires every reference to be schema-qualified. These
-- five bodies reference only NEW/OLD and pg_catalog built-ins, so they are
-- already compliant.
-- ============================================================================
alter function app.touch_updated_at() set search_path = '';
alter function app.touch_asset_updated() set search_path = '';
alter function app.block_if_approved_case() set search_path = '';
alter function app.block_transaction_change() set search_path = '';
alter function app.block_underwriting_plan() set search_path = '';

-- No blanket EXECUTE. `create function` grants EXECUTE to PUBLIC by default, so
-- this is re-asserted after every migration that adds one; the enumerated
-- grants from 0001 and 0005 (the P1 privilege matrix) are untouched by it.
revoke all on schema app from public, anon;
revoke execute on all functions in schema app from public, anon;

-- ============================================================================
-- 5. Assert the result, in the migration itself
-- ----------------------------------------------------------------------------
-- A privilege regression is silent by nature — everything keeps working, and
-- the only symptom is a right nobody meant to grant. These checks fail the
-- migration rather than let that ship, and they run against whatever catalogue
-- the migration was applied to, live or local.
-- ============================================================================
do $$
declare
  leaked text;
begin
  -- Nothing in `public` may be reachable by anon or PUBLIC.
  select string_agg(distinct c.relname || ':' || a.privilege_type, ', ')
    into leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  if leaked is not null then
    raise exception 'anon/PUBLIC still hold privileges in public: %', leaked;
  end if;

  -- `authenticated` may hold no TRUNCATE, REFERENCES or TRIGGER anywhere.
  select string_agg(distinct c.relname || ':' || a.privilege_type, ', ')
    into leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public'
     and a.grantee = 'authenticated'::regrole
     and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  if leaked is not null then
    raise exception 'authenticated still holds structural privileges: %', leaked;
  end if;

  -- Every table in `public` keeps row level security enabled. Extension-owned
  -- relations are Supabase's to manage, not this application's.
  select string_agg(c.relname, ', ')
    into leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  if leaked is not null then
    raise exception 'row level security is not enabled on: %', leaked;
  end if;

  -- Every function in `app` pins a search_path.
  select string_agg(p.proname, ', ')
    into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                      where cfg like 'search\_path=%');
  if leaked is not null then
    raise exception 'functions in app without a pinned search_path: %', leaked;
  end if;
end $$;
