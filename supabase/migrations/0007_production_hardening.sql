-- ============================================================================
-- 0007 — Production hardening (P6)
-- ----------------------------------------------------------------------------
-- Three corrections, each found by auditing the LIVE catalogue rather than by
-- assuming what earlier migrations achieved:
--
--   1. `anon` held full DML on every table in `public`, and Supabase's project
--      default privileges would grant it on every FUTURE table too. RLS was the
--      only thing standing in the way. That is one layer where there should be
--      two — and TRUNCATE is not subject to row security at all.
--
--   2. `authenticated` held TRUNCATE / REFERENCES / TRIGGER everywhere for the
--      same reason. The application needs none of them, and TRUNCATE would
--      bypass every policy in this schema.
--
--   3. The activity record was mutable by an administrator: the uniform
--      `_admin` policy from 0005 is FOR ALL. An audit trail an operator can
--      rewrite is not an audit trail.
--
-- Nothing here widens any access. Every statement removes a privilege, splits a
-- policy into a narrower one, or pins a search_path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Project default privileges — stop future tables leaking to `anon`
-- ---------------------------------------------------------------------------
-- Supabase configures ALTER DEFAULT PRIVILEGES so that anything created in
-- `public` is granted to anon / authenticated / service_role automatically.
-- Migrations run as `postgres`, so that grantor is the one that decides what a
-- future migration silently exposes; `supabase_admin` is corrected too when
-- this role is permitted to.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Narrow what `authenticated` inherits to the four verbs the application uses.
-- TRUNCATE especially: it is NOT subject to row level security.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
  execute 'alter default privileges for role supabase_admin in schema public
             revoke truncate, references, trigger on tables from authenticated';
exception when insufficient_privilege or undefined_object then
  -- Not a member of supabase_admin on this project. The `postgres` grantor
  -- above is the one migrations actually use, so the guarantee still holds for
  -- everything this repository creates; objects created from the Supabase
  -- dashboard would need the same correction applied there.
  raise notice '0007: could not adjust supabase_admin default privileges (not a member) — postgres grantor corrected';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Existing objects — take back what was granted before the defaults changed
-- ---------------------------------------------------------------------------
-- `anon` is the role an UNAUTHENTICATED PostgREST request arrives on. Nothing
-- in this product is served to it: the portal and the internal app both reach
-- Postgres through the server, never through PostgREST as anon.
do $$
declare r record;
begin
  for r in
    select c.relname, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke all on public.%I from anon', r.relname);
    execute format('revoke all on public.%I from public', r.relname);
    -- Keep the four verbs the app uses; drop the three it never does.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', r.relname);
  end loop;

  for r in select sequencename from pg_sequences where schemaname = 'public' loop
    execute format('revoke all on sequence public.%I from anon', r.sequencename);
    execute format('revoke all on sequence public.%I from public', r.sequencename);
  end loop;
end $$;

-- `investor_feed` is a read projection; SELECT is the only verb it ever needs.
revoke insert, update, delete on investor_feed from authenticated;

-- ---------------------------------------------------------------------------
-- 3. The activity record becomes genuinely append-only
-- ---------------------------------------------------------------------------
-- Investors could already only insert their own rows and read them back. What
-- changes here is the ADMINISTRATOR: the uniform FOR ALL policy is replaced by
-- a read-only one, and the UPDATE/DELETE privileges come off the table, so no
-- role reachable from the application can rewrite history. Corrections are made
-- by recording a new event, never by editing an old one.
--
-- The privileged migration/maintenance connection (`postgres`, BYPASSRLS) can
-- still drop and rebuild the schema — that is what `db:reset` is — but it is
-- not a role any request runs as.
drop policy if exists investor_activity_events_admin on investor_activity_events;

drop policy if exists investor_activity_admin_read on investor_activity_events;
create policy investor_activity_admin_read on investor_activity_events
  for select to authenticated using (app.is_admin());

revoke update, delete, truncate on investor_activity_events from authenticated;

comment on table investor_activity_events is
  'Append-only audit record of investor actions. No policy permits UPDATE or '
  'DELETE for any application role; correct a mistake by recording a new event.';

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on the remaining trigger functions
-- ---------------------------------------------------------------------------
-- Every SECURITY DEFINER function already pins an empty search_path (P1). These
-- five are SECURITY INVOKER trigger functions that did not, which is a smaller
-- risk but the same class of one. `pg_catalog` is added where the body needs
-- built-ins under a pinned path.
alter function app.touch_updated_at() set search_path = '';
alter function app.touch_asset_updated() set search_path = '';
alter function app.block_if_approved_case() set search_path = '';
alter function app.block_transaction_change() set search_path = '';
alter function app.block_underwriting_plan() set search_path = '';
