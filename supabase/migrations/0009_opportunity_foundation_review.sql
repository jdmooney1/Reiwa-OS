-- ============================================================================
-- 0009 — Opportunity foundation, review corrections (Phase 1A)
-- ----------------------------------------------------------------------------
-- Five defects found reviewing 0008. Each is a place where the schema allowed
-- a fact to be true in two places at once, or allowed a record people will
-- rely on years later to be changed without trace.
--
--   1. Financial truth existed twice — on `opportunities` and on the versioned
--      `investment_cases`, both independently writable.
--   2. `last_material_update_at` moved only on a stage change, so the name
--      promised more than the column delivered.
--   3. A DD framework could be applied once and never supplemented.
--   4. An IC decision's conditions and rationale could be rewritten in place.
--   5. Deleting an underwriting version or a decision silently erased the
--      provenance of an investor publication.
-- ============================================================================

-- ============================================================================
-- 1. One source of financial truth
-- ----------------------------------------------------------------------------
-- `opportunities` carried target_price, niy, reversionary_yield, passing_rent,
-- erv, capex_budget, target_irr and equity_multiple. Every one of them also
-- exists on `investment_cases`, which is versioned, authored and immutable once
-- approved. Two writable copies of a purchase price is how a pipeline shows
-- £42.5m while the approved underwriting says £38m, and nobody can say which is
-- the number.
--
-- The columns are NOT dropped. `app.opportunity_publication_source()` reads
-- four of them to prefill an investor publication draft, and that boundary is
-- deliberately out of scope. Instead they stop being an input and become a
-- PROJECTION of the authoritative case, maintained here rather than by any
-- caller. The data layer refuses to write them (see opportunities.ts).
--
-- Authoritative version = the approved one if there is one, otherwise the
-- current working one. One rule, stated once.
-- ============================================================================
create or replace function app.project_case_to_opportunity() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    opp uuid := coalesce(new.opportunity_id, old.opportunity_id);
    src public.investment_cases;
  begin
    select * into src from public.investment_cases
     where opportunity_id = opp and status in ('approved', 'current')
     order by (status = 'approved') desc, version desc
     limit 1;

    if not found then return null; end if;

    update public.opportunities o
       set target_price       = src.acquisition_price,
           niy                = src.entry_yield_pct,
           reversionary_yield = src.exit_yield_pct,
           passing_rent       = src.gross_rental_income,
           erv                = src.erv,
           capex_budget       = src.capex,
           target_irr         = src.target_irr,
           equity_multiple    = src.target_equity_multiple
     where o.opportunity_id = opp
       and (o.target_price, o.niy, o.reversionary_yield, o.passing_rent,
            o.erv, o.capex_budget, o.target_irr, o.equity_multiple)
           is distinct from
           (src.acquisition_price, src.entry_yield_pct, src.exit_yield_pct,
            src.gross_rental_income, src.erv, src.capex, src.target_irr,
            src.target_equity_multiple);
    return null;
  end
  $fn$;
drop trigger if exists trg_cases_project on investment_cases;
create trigger trg_cases_project after insert or update on investment_cases
  for each row execute function app.project_case_to_opportunity();

comment on column opportunities.target_price is
  'DERIVED from the authoritative investment case (approved, else current). Do not write directly.';
comment on column opportunities.niy is
  'DERIVED from investment_cases.entry_yield_pct. Do not write directly.';
comment on column opportunities.reversionary_yield is
  'DERIVED from investment_cases.exit_yield_pct. Do not write directly.';
comment on column opportunities.passing_rent is
  'DERIVED from investment_cases.gross_rental_income. Do not write directly.';
comment on column opportunities.erv is
  'DERIVED from investment_cases.erv. Do not write directly.';
comment on column opportunities.capex_budget is
  'DERIVED from investment_cases.capex. Do not write directly.';
comment on column opportunities.target_irr is
  'DERIVED from investment_cases.target_irr. Do not write directly.';
comment on column opportunities.equity_multiple is
  'DERIVED from investment_cases.target_equity_multiple. Do not write directly.';

-- ============================================================================
-- 2. Honest timestamp semantics
-- ----------------------------------------------------------------------------
-- The column claimed "material update" and delivered "stage or status changed".
-- Rather than rename it down to what it did, widen it to what it says — but
-- from a CLOSED list of four events, not a general event system:
--
--   * stage or status moved            (already)
--   * a new underwriting version exists
--   * a committee decision was recorded
--   * diligence found an issue, or a risk was raised
--
-- Each is something that changes what somebody reviewing the pipeline should
-- look at. Editing a summary is not, and still does not move it.
-- ============================================================================
create or replace function app.touch_opportunity_material() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    update public.opportunities
       set last_material_update_at = now()
     where opportunity_id = new.opportunity_id;
    return null;
  end
  $fn$;

drop trigger if exists trg_cases_material on investment_cases;
create trigger trg_cases_material after insert on investment_cases
  for each row execute function app.touch_opportunity_material();

drop trigger if exists trg_icdecisions_material on ic_decisions;
create trigger trg_icdecisions_material after insert on ic_decisions
  for each row execute function app.touch_opportunity_material();

drop trigger if exists trg_opprisks_material on opportunity_risks;
create trigger trg_opprisks_material after insert on opportunity_risks
  for each row execute function app.touch_opportunity_material();

-- Only an ISSUE counts. A workstream moving from Requested to Received is
-- progress, not news.
drop trigger if exists trg_dditems_material on opportunity_dd_items;
create trigger trg_dditems_material after update on opportunity_dd_items
  for each row when (new.status = 'issue_identified' and old.status is distinct from 'issue_identified')
  execute function app.touch_opportunity_material();

comment on column opportunities.last_material_update_at is
  'Set when the opportunity moves stage/status, gains an underwriting version or an IC decision, or diligence raises an issue or a risk. Not touched by ordinary edits.';

-- ============================================================================
-- 3. Supplemental due diligence frameworks
-- ----------------------------------------------------------------------------
-- 0008 refused a second template outright, which prevented applying the same
-- framework twice (right) and also prevented adding a supplemental framework
-- later (wrong — a cross-border tax pack or an ESG pack is a normal thing to
-- add mid-diligence).
--
-- A stable key per instantiated line replaces the blanket refusal. Applying the
-- same template again collides and is refused per item; applying a DIFFERENT
-- one simply adds its lines. Items added by hand carry no key and are never in
-- the way.
--
-- Completion maths is unaffected: src/lib/dd/progress.ts counts rows, and these
-- are still rows.
-- ============================================================================
alter table opportunity_dd_items
  add column if not exists template_item_key text;

create unique index if not exists opportunity_dd_items_template_item
  on opportunity_dd_items(opportunity_id, template_item_key)
  where template_item_key is not null;

comment on column opportunity_dd_items.template_item_key is
  'Stable identity of a templated line (templateId:section:item). Unique per opportunity, so the same framework cannot be applied twice while a supplemental one can be added. Null for hand-added items.';

-- Backfill anything 0008 already instantiated.
update opportunity_dd_items
   set template_item_key = template_id || ':' || section || ':' || item
 where template_id is not null and template_item_key is null;

-- ============================================================================
-- 4. IC decisions: immutable original, explicit amendment
-- ----------------------------------------------------------------------------
-- 0008 let conditions, rationale, follow_up and decision_makers be edited in
-- place, reasoning that minutes get tidied. That was wrong. It means the answer
-- to "what did the committee actually approve?" can be changed by anyone with
-- write access, at any time, leaving no trace — which is precisely the question
-- this record exists to answer.
--
-- The decision row is now immutable in full. A correction is a new, attributed
-- row: what changed, who changed it, when, and why. The original is never
-- rewritten, and the two are always distinguishable.
-- ============================================================================
create table if not exists ic_decision_amendments (
  amendment_id uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(org_id) on delete cascade,
  decision_id  uuid not null references ic_decisions(decision_id) on delete restrict,

  -- The replacement text. Null means "this amendment does not touch that part",
  -- which is why the effective value is the latest NON-NULL one, not simply the
  -- latest row.
  amended_conditions text,
  amended_rationale  text,
  amended_follow_up  text,

  -- Not optional. An amendment without a stated reason is indistinguishable
  -- from a quiet rewrite, which is the thing being prevented.
  reason     text not null check (length(btrim(reason)) > 0),
  amended_by uuid references profiles(user_id),
  created_at timestamptz not null default now()
);
create index if not exists idx_icamendments_decision
  on ic_decision_amendments(decision_id, created_at);

-- An amendment is itself part of the record.
create or replace function app.guard_ic_amendment() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    raise exception 'Decision amendment % is a permanent record; add another amendment instead',
      coalesce(old.amendment_id, new.amendment_id);
  end
  $fn$;
drop trigger if exists trg_icamendments_guard on ic_decision_amendments;
create trigger trg_icamendments_guard before update or delete on ic_decision_amendments
  for each row execute function app.guard_ic_amendment();

-- The decision row itself no longer has amendable columns.
create or replace function app.guard_ic_decision() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'DELETE' then
      raise exception 'Investment committee decision % is a permanent record', old.decision_id;
    end if;
    raise exception 'Investment committee decision % cannot be altered; record an amendment instead',
      old.decision_id;
  end
  $fn$;

do $$
declare t text;
begin
  foreach t in array array['ic_decision_amendments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    -- No update or delete policy: the trigger refuses both, and so does RLS.
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert on %I to authenticated', t);
  end loop;
end $$;

-- ============================================================================
-- 5. Durable publication provenance
-- ----------------------------------------------------------------------------
-- 0008 attached the provenance with ON DELETE SET NULL so that deleting a case
-- or a decision could never block a publication. That protected the wrong
-- thing. Publication CONTENT is an independent immutable snapshot and is not at
-- risk either way; what SET NULL protected was the ability to delete the source
-- record, at the cost of silently erasing the only record of what an investor
-- was shown as approved.
--
-- RESTRICT instead. Once an underwriting version or a decision has been cited
-- to an investor, it stops being deletable — which is the same rule
-- `publication_sources.opportunity_id` has carried since 0005, for the same
-- reason. Nothing investor-facing changes: no version content, no entitlement,
-- no document tier and no delivery path is touched.
-- ============================================================================
alter table publication_version_sources
  drop constraint if exists publication_version_sources_source_investment_case_id_fkey,
  drop constraint if exists publication_version_sources_source_ic_decision_id_fkey;

alter table publication_version_sources
  add constraint publication_version_sources_source_investment_case_id_fkey
    foreign key (source_investment_case_id)
    references investment_cases(case_id) on delete restrict,
  add constraint publication_version_sources_source_ic_decision_id_fkey
    foreign key (source_ic_decision_id)
    references ic_decisions(decision_id) on delete restrict;

-- ============================================================================
-- 6. Function privileges
-- ----------------------------------------------------------------------------
-- Same posture as 0008 §9: the default privilege fix applies to roles that
-- existed when it ran, so re-assert on what this migration created.
-- ============================================================================
revoke execute on all functions in schema app from public, anon;
