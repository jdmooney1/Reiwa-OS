-- ============================================================================
-- 0050 — opportunities.legacy_exempt: an explicit, audited grandfather flag
-- ----------------------------------------------------------------------------
-- Replaces 0048's `document_stage > 0` exemption from I1. That exemption was
-- too wide: ANY opportunity, including one created today, could skip the
-- readiness tracker entirely (never advance document_stage) and convert with
-- no clearance at all — not just the opportunities that genuinely predate
-- the Session 3 feature.
--
-- `legacy_exempt` makes the exemption a fact about a SPECIFIC opportunity,
-- not a side effect of a column it never happened to touch:
--   - every opportunity that exists AT THIS MIGRATION is grandfathered
--     (legacy_exempt = true) — exactly the set 0048's old condition meant to
--     protect, and nothing wider.
--   - every opportunity created AFTER this migration defaults to false and
--     must pass Stage 3/4 clearance (or override) to convert, regardless of
--     whether it ever touches document_stage.
--   - turning it on for an opportunity that did not start that way is an
--     admin action, audited the same way a doc_type catalogue edit is
--     (0036): an append-only table, written by a SECURITY DEFINER trigger
--     that `authenticated` cannot write to directly.
--
-- The backfill is done via ADD COLUMN's own default, not a bulk UPDATE: a
-- metadata-only default (Postgres 11+) fills every existing row without
-- issuing a per-row UPDATE, so it does not fire the admin-guard trigger
-- added below — there is no "who approved backfilling every existing deal"
-- question to beg, because nothing resembling a grant is happening, only a
-- column getting a value it already implicitly had.
-- ============================================================================

alter table opportunities add column if not exists legacy_exempt boolean not null default true;
alter table opportunities alter column legacy_exempt set default false;

comment on column opportunities.legacy_exempt is
  'True for every opportunity that existed before Session 3''s readiness tracker (migration 0050) — exempts it from I1''s Stage-4 clearance requirement (0048). False by default for everything created after. Turning it on later is an admin action, audited in opportunity_legacy_exempt_audit.';

-- ---- Audit: same shape and reasoning as doc_type_audit (0036) --------------
create table if not exists opportunity_legacy_exempt_audit (
  audit_id       uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  before         boolean not null,
  after          boolean not null,
  changed_by     uuid references profiles(user_id),
  changed_at     timestamptz not null default now()
);
create index if not exists idx_opportunity_legacy_exempt_audit_opp
  on opportunity_legacy_exempt_audit(opportunity_id, changed_at desc);

comment on table opportunity_legacy_exempt_audit is
  'Append-only history of opportunities.legacy_exempt changes. Written only by app.record_legacy_exempt_audit() — never by application code.';

create or replace function app.record_legacy_exempt_audit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if new.legacy_exempt is distinct from old.legacy_exempt then
      insert into public.opportunity_legacy_exempt_audit (opportunity_id, before, after, changed_by)
        values (new.opportunity_id, old.legacy_exempt, new.legacy_exempt, app.current_user_id()::uuid);
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_opportunity_legacy_exempt_audit on opportunities;
create trigger trg_opportunity_legacy_exempt_audit after update on opportunities
  for each row execute function app.record_legacy_exempt_audit();

alter table opportunity_legacy_exempt_audit enable row level security;
drop policy if exists opportunity_legacy_exempt_audit_select on opportunity_legacy_exempt_audit;
create policy opportunity_legacy_exempt_audit_select on opportunity_legacy_exempt_audit for select to authenticated
  using (exists (
    select 1 from opportunities o
     where o.opportunity_id = opportunity_legacy_exempt_audit.opportunity_id
       and app.has_org(o.org_id)
  ));
-- No insert/update/delete policy for any role — same reasoning as 0036: the
-- trigger is SECURITY DEFINER, and `authenticated` has no grant to write
-- this table directly (below).

revoke all on opportunity_legacy_exempt_audit from anon, public;
grant select on opportunity_legacy_exempt_audit to authenticated;

-- ---- Guard: turning the flag ON after creation is an admin-only act --------
-- Turning it OFF is not gated here — that only tightens what I1 requires of
-- the opportunity, never loosens it, so it needs no more privilege than any
-- other write to the row (RLS on opportunities, 0002, already requires
-- can_write()). Every change either way is still audited, above.
create or replace function app.guard_legacy_exempt_admin() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if new.legacy_exempt and not old.legacy_exempt and not app.is_admin() then
      raise exception
        'opportunities.legacy_exempt (%) may only be set to true by a reiwa_admin',
        old.opportunity_id;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_opportunity_legacy_exempt_admin on opportunities;
create trigger trg_opportunity_legacy_exempt_admin before update on opportunities
  for each row execute function app.guard_legacy_exempt_admin();

-- ---- Redefine I1 (0048) to key off legacy_exempt, not document_stage ------
-- Same function 0048 created; redefined here, now that the column it needs
-- exists. The trigger itself is unchanged (still `before update on
-- opportunities`, still this same function) — only the function body moves
-- from `document_stage > 0` to `not legacy_exempt`.
create or replace function app.guard_opportunity_stage_acquired() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    has_clearance boolean;
  begin
    if new.stage = 'acquired' and old.stage is distinct from 'acquired' and not new.legacy_exempt then
      select exists (
        select 1 from public.stage_transition st
         where st.opportunity_id = new.opportunity_id
           and st.to_stage = 4
      ) into has_clearance;
      if not has_clearance then
        raise exception
          'opportunities.stage cannot become acquired for % without a recorded stage_transition clearance into Stage 4 (Closing gates passed or overridden)',
          new.opportunity_id;
      end if;
    end if;
    return new;
  end
  $fn$;

-- ROLLBACK:
--   create or replace function app.guard_opportunity_stage_acquired() ... -- restore 0048's body (document_stage > 0)
--   drop trigger if exists trg_opportunity_legacy_exempt_admin on opportunities;
--   drop function if exists app.guard_legacy_exempt_admin();
--   drop trigger if exists trg_opportunity_legacy_exempt_audit on opportunities;
--   drop function if exists app.record_legacy_exempt_audit();
--   drop table if exists opportunity_legacy_exempt_audit;
--   alter table opportunities drop column if exists legacy_exempt;
