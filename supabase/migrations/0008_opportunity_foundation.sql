-- ============================================================================
-- 0008 — Opportunity Data Foundation (Phase 1A)
-- ----------------------------------------------------------------------------
-- The pre-acquisition truth layer. Phase 0 established `opportunities` as the
-- canonical pre-acquisition object and removed the mock model that competed
-- with it; this migration gives that object the record it needs to carry an
-- investment from origination to an investment committee decision.
--
-- FOUR THINGS EXISTED ALREADY AND ARE NOT DUPLICATED HERE:
--
--   * `investment_cases` is already a versioned, per-opportunity, immutable-
--     once-approved underwriting record. A separate `underwriting_versions`
--     table would have been the same thing twice, so this migration EXTENDS it
--     rather than replacing it.
--   * `publication_sources` already carries opportunity -> publication, unique
--     and admin-only. The publication boundary is correct and is not rebuilt.
--   * `asset_risks` / `asset_decisions` already exist post-acquisition. The new
--     opportunity-side risk table deliberately mirrors their column shapes so
--     Phase 2 conversion is an INSERT ... SELECT rather than a translation.
--   * The private document bucket, its tiers and its signed-URL delivery are
--     untouched. Internal documents get a relationship, not a second system.
--
-- Nothing investor-facing changes: no investor table, policy, entitlement or
-- delivery path is altered.
-- ============================================================================

-- ============================================================================
-- 1. Opportunities — origination and workflow state
-- ----------------------------------------------------------------------------
-- Identity, sourcing and workflow only. The financial model belongs in the
-- investment case, which is versioned; putting it here would make it
-- overwritable, which is precisely what Phase 1A exists to prevent.
-- ============================================================================
alter table opportunities
  -- Origination. Deliberately NOT a CRM: a source is a few facts about how the
  -- opportunity reached Reiwa, not a contact-management subsystem. If a real
  -- counterparty directory is ever needed, these columns are what it replaces.
  add column if not exists source_type text not null default 'other'
    check (source_type in ('off_market', 'broker_marketed', 'direct_approach',
                           'referral', 'existing_relationship', 'other')),
  add column if not exists source_contact_name  text,
  add column if not exists source_contact_email text,
  add column if not exists sourced_at           date,
  add column if not exists referral_note        text,

  -- Workflow.
  add column if not exists priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  add column if not exists next_milestone      text,
  add column if not exists next_milestone_date date,
  -- `updated_at` moves on every edit, including a typo fix. This moves only
  -- when the opportunity's position actually changes, which is the thing a
  -- pipeline review wants to sort by.
  add column if not exists last_material_update_at timestamptz;

comment on column opportunities.source is
  'Free-text origination detail (e.g. the marketed process name). The structured vocabulary is source_type.';

create index if not exists idx_opportunities_priority
  on opportunities(org_id, priority) where archived_at is null;

create or replace function app.touch_material_update() returns trigger
  language plpgsql
  set search_path = ''
  as $$
  begin
    if old.stage is distinct from new.stage or old.status is distinct from new.status then
      new.last_material_update_at = now();
    end if;
    return new;
  end $$;
drop trigger if exists trg_opportunities_material on opportunities;
create trigger trg_opportunities_material before update on opportunities
  for each row execute function app.touch_material_update();

-- ============================================================================
-- 2. Investment cases — the versioned underwriting record
-- ----------------------------------------------------------------------------
-- This table already had (opportunity_id, version), a draft/approved status,
-- an approved_at stamp and an immutability trigger. What it lacked was the
-- rest of the reporting spine, an author, and a lifecycle that could express
-- "this is the version being worked on" separately from "this is a stale
-- draft nobody is using".
--
-- Status vocabulary:
--   draft      — being written; several may exist
--   current    — THE working version. At most one per opportunity.
--   approved   — signed off by the IC. Immutable. At most one live per opportunity.
--   superseded — replaced by a later approved version. Immutable.
--
-- The two partial unique indexes below are what make "current working
-- underwriting" and "IC-approved underwriting" unambiguous answers rather than
-- conventions someone has to remember.
-- ============================================================================
alter table investment_cases
  drop constraint if exists investment_cases_status_check;
alter table investment_cases
  add constraint investment_cases_status_check
    check (status in ('draft', 'current', 'approved', 'superseded'));

alter table investment_cases
  -- Strategy and narrative.
  add column if not exists strategy         text,
  add column if not exists change_rationale text,

  -- Cost side.
  add column if not exists acquisition_costs numeric(18,2),
  add column if not exists equity            numeric(18,2),

  -- Income side.
  add column if not exists gross_rental_income numeric(18,2),

  -- Debt terms. `debt` and `ltv_pct` (leverage) already existed.
  add column if not exists debt_cost_pct numeric(7,4),

  -- Exit.
  add column if not exists exit_value        numeric(18,2),
  add column if not exists hold_period_years numeric(5,2),
  add column if not exists entry_yield_pct   numeric(7,4),
  add column if not exists exit_yield_pct    numeric(7,4),

  -- Strategy-specific structured inputs that are not part of the shared spine.
  -- This is the pressure valve that stops the column list growing every time a
  -- strategy needs one more number. It is NOT a place for the spine to hide.
  add column if not exists assumptions jsonb not null default '{}'::jsonb,

  -- Authorship. Every version must say who wrote it and who signed it off.
  add column if not exists created_by    uuid references profiles(user_id),
  add column if not exists approved_by   uuid references profiles(user_id),
  add column if not exists superseded_at timestamptz;

-- Total cost is generated, not stored by the application: three columns that
-- must add up cannot disagree if only one of them is writable.
alter table investment_cases
  add column if not exists total_cost numeric(18,2)
    generated always as (
      case when acquisition_price is null then null
           else acquisition_price
                + coalesce(acquisition_costs, 0)
                + coalesce(capex, 0)
      end
    ) stored;

comment on column investment_cases.valuation is
  'Entry/current valuation. The stabilised or exit value is exit_value.';
comment on column investment_cases.business_plan_assumptions is
  'Narrative description of the business plan. Structured strategy-specific inputs are in assumptions (jsonb).';

-- At most one working version per opportunity.
create unique index if not exists investment_cases_single_current
  on investment_cases(opportunity_id) where status = 'current';

-- At most one LIVE approved version per opportunity. Earlier approvals remain
-- as `superseded` — the history is kept, the answer stays singular.
create unique index if not exists investment_cases_single_approved
  on investment_cases(opportunity_id) where status = 'approved';

-- Lets an IC decision prove, in the schema, that the underwriting it approved
-- belongs to the opportunity it decided on. A plain FK to case_id could not.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'investment_cases_case_opportunity_key') then
    alter table investment_cases
      add constraint investment_cases_case_opportunity_key unique (case_id, opportunity_id);
  end if;
end $$;

-- ---- Immutability, with one permitted transition ---------------------------
-- Replaces app.block_if_approved_case. An approved case still cannot be edited
-- or deleted; the single exception is the supersede stamp, applied when a later
-- version is approved in its place. Same shape as the guard on published
-- publication versions (0005), for the same reason: history has to be closable
-- without being rewritable.
create or replace function app.block_if_approved_case() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'DELETE' then
      if old.status in ('approved', 'superseded') then
        raise exception 'Approved investment case % is immutable', old.case_id;
      end if;
      return old;
    end if;

    if old.status = 'superseded' then
      raise exception 'Investment case % is superseded and immutable', old.case_id;
    end if;

    if old.status = 'approved' then
      if new.status <> 'superseded' then
        raise exception 'Approved investment case % is immutable', old.case_id;
      end if;
      -- Only the status and the supersede stamp may move. Any other column
      -- change is an attempt to rewrite what the IC signed off.
      --
      -- `total_cost` is excluded because it is a GENERATED column: in a BEFORE
      -- trigger PostgreSQL has not computed it yet, so new.total_cost is null
      -- while old.total_cost holds the stored value, and a naive comparison
      -- reads that as tampering and blocks the supersede. Excluding it is safe
      -- precisely because it is derived — it cannot move unless one of the
      -- columns it is computed from moves, and those are all still compared.
      if (to_jsonb(old) - 'status' - 'superseded_at' - 'total_cost')
         <> (to_jsonb(new) - 'status' - 'superseded_at' - 'total_cost') then
        raise exception 'Approved investment case % is immutable', old.case_id;
      end if;
      return new;
    end if;

    return new;
  end
  $fn$;

-- ============================================================================
-- 3. Opportunity documents
-- ----------------------------------------------------------------------------
-- A relationship, not a second document system. Files live in the SAME private
-- bucket, are never public, and are delivered by the same short-lived signed
-- URL discipline. `access_level` uses the vocabulary already established for
-- publication documents so that a file can later be promoted into a
-- publication without being copied or re-tiered.
--
-- `internal` is the default here, because a diligence document is internal
-- until somebody deliberately decides otherwise.
-- ============================================================================
create table if not exists opportunity_documents (
  document_id    uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  title          text not null,
  -- The 15-category taxonomy preserved in src/lib/documents/catalog.ts, which
  -- maps each category to the DD section a finding from it belongs to.
  category       text not null default 'Other',
  storage_path   text not null,
  file_name      text,
  mime_type      text,
  size_bytes     bigint,
  access_level   text not null default 'internal'
                   check (access_level in ('standard', 'diligence', 'internal')),
  uploaded_by    uuid references profiles(user_id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_oppdocs_opportunity on opportunity_documents(opportunity_id);

-- ============================================================================
-- 4. Due diligence
-- ----------------------------------------------------------------------------
-- Instantiated from the firm's standing frameworks (src/lib/dd/templates.ts:
-- 21 sections, jurisdiction-branched for London and Amsterdam). Belongs to the
-- OPPORTUNITY: diligence happens before acquisition, on the pre-acquisition
-- object.
--
-- This is investment diligence, not task management. There is no assignee
-- inbox, no sub-task tree and no workflow engine — there is a question, who
-- owns answering it, what was found, and whether it is cleared.
-- ============================================================================
create table if not exists opportunity_dd_items (
  dd_item_id     uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,

  -- Framework position.
  section      text not null,
  item         text not null,
  question     text,
  jurisdiction text not null default 'UK'
                 check (jurisdiction in ('UK', 'Netherlands', 'Japan', 'Cross-border')),
  template_id  text,

  priority text not null default 'medium'
             check (priority in ('low', 'medium', 'high', 'critical')),
  status   text not null default 'not_started'
             check (status in ('not_started', 'requested', 'in_progress', 'received',
                               'reviewed', 'issue_identified', 'resolved', 'not_applicable')),
  risk_level text check (risk_level in ('low', 'medium', 'high')),

  owner_user_id uuid references profiles(user_id),
  due_date      date,

  -- The diligence itself.
  finding    text,
  resolution text,
  notes      text,
  source_document_id uuid references opportunity_documents(document_id) on delete set null,

  completed_at timestamptz,
  created_by   uuid references profiles(user_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_dditems_opportunity on opportunity_dd_items(opportunity_id);
create index if not exists idx_dditems_open
  on opportunity_dd_items(opportunity_id, status)
  where status not in ('reviewed', 'resolved', 'not_applicable');

drop trigger if exists trg_dditems_touch on opportunity_dd_items;
create trigger trg_dditems_touch before update on opportunity_dd_items
  for each row execute function app.touch_updated_at();

-- A workstream is "cleared" when Reviewed or Resolved (src/lib/dd/progress.ts).
-- Stamping that here rather than in the application means the completion date
-- cannot drift from the status it describes.
create or replace function app.stamp_dd_completion() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if new.status in ('reviewed', 'resolved') then
      if new.completed_at is null then new.completed_at = now(); end if;
    else
      new.completed_at = null;
    end if;
    return new;
  end
  $fn$;
drop trigger if exists trg_dditems_completion on opportunity_dd_items;
create trigger trg_dditems_completion before insert or update on opportunity_dd_items
  for each row execute function app.stamp_dd_completion();

-- ============================================================================
-- 5. Opportunity risks
-- ----------------------------------------------------------------------------
-- The pre-acquisition risk register. Column shapes mirror `asset_risks` so that
-- Phase 2 conversion is an INSERT ... SELECT, not a field-by-field translation.
--
-- Two links matter and are the reason this is a table rather than a view:
--   * source_dd_item_id — a material diligence finding is PROMOTED into a
--     persistent risk. The risk lives here once; the DD item keeps its finding.
--     Neither is a copy of the other.
--   * migrated_to_asset_risk_id — set when the risk carries over at
--     acquisition, so the same risk cannot be migrated twice.
-- ============================================================================
create table if not exists opportunity_risks (
  risk_id        uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,

  title       text not null,
  category    text not null default 'other',
  description text,
  severity    text not null default 'medium'
                check (severity in ('low', 'medium', 'high', 'critical')),
  probability int check (probability between 1 and 5),
  financial_impact numeric(18,2),
  mitigation  text,
  owner_user_id uuid references profiles(user_id),
  status      text not null default 'open'
                check (status in ('open', 'mitigated', 'accepted', 'closed')),

  source_dd_item_id uuid references opportunity_dd_items(dd_item_id) on delete set null,
  migrated_to_asset_risk_id uuid references asset_risks(risk_id) on delete set null,

  created_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_opprisks_opportunity on opportunity_risks(opportunity_id);
create unique index if not exists opportunity_risks_single_migration
  on opportunity_risks(migrated_to_asset_risk_id)
  where migrated_to_asset_risk_id is not null;

drop trigger if exists trg_opprisks_touch on opportunity_risks;
create trigger trg_opprisks_touch before update on opportunity_risks
  for each row execute function app.touch_updated_at();

-- ============================================================================
-- 6. Investment Committee decisions
-- ----------------------------------------------------------------------------
-- The answer, years later, to "why did we approve this investment?".
--
-- A decision names the OPPORTUNITY and the exact UNDERWRITING VERSION it was
-- taken on. The composite foreign key below means the schema itself refuses a
-- decision that approves one opportunity's underwriting on another's file.
--
-- The outcome vocabulary is four values. There is no voting model: attendees
-- are recorded as names because an IC includes people who are not users of this
-- system, and a join table to `profiles` would quietly exclude them.
-- ============================================================================
create table if not exists ic_decisions (
  decision_id        uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(org_id) on delete cascade,
  opportunity_id     uuid not null references opportunities(opportunity_id) on delete cascade,
  investment_case_id uuid not null,

  decision_date  date not null default current_date,
  recommendation text check (recommendation in ('strong_proceed', 'proceed',
                                                'proceed_with_caution', 'weak', 'reject')),
  outcome        text not null
                   check (outcome in ('approved', 'approved_with_conditions',
                                      'deferred', 'rejected')),
  conditions      text,
  rationale       text,
  follow_up       text,
  decision_makers text[] not null default '{}',

  recorded_by uuid references profiles(user_id),
  created_at  timestamptz not null default now(),

  -- The underwriting version must belong to the opportunity being decided on.
  constraint ic_decisions_case_fkey
    foreign key (investment_case_id, opportunity_id)
    references investment_cases(case_id, opportunity_id) on delete restrict
);
create index if not exists idx_icdecisions_opportunity
  on ic_decisions(opportunity_id, decision_date desc);
create index if not exists idx_icdecisions_case on ic_decisions(investment_case_id);

-- ---- Approval is an event with consequences --------------------------------
-- Recording an approval is what makes an underwriting version approved. Doing
-- this in the trigger rather than the application means there is no path to an
-- approved IC decision pointing at a draft, and no path to two live approved
-- versions for one opportunity.
--
-- A deferral or rejection changes NO case status. That is the whole point of
-- separating outcome from underwriting state: an IC that says "come back with
-- more work" must not leave anything looking signed off.
create or replace function app.apply_ic_decision() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    case_status text;
  begin
    select status into case_status
      from public.investment_cases where case_id = new.investment_case_id;

    if case_status = 'superseded' then
      raise exception 'Investment case % is superseded and cannot be taken to committee',
        new.investment_case_id;
    end if;

    if new.outcome in ('approved', 'approved_with_conditions') then
      -- Close out any earlier approval for this opportunity first, so the
      -- single-live-approved index never sees two.
      update public.investment_cases
         set status = 'superseded', superseded_at = now()
       where opportunity_id = new.opportunity_id
         and status = 'approved'
         and case_id <> new.investment_case_id;

      if case_status <> 'approved' then
        update public.investment_cases
           set status = 'approved', approved_at = now(), approved_by = new.recorded_by
         where case_id = new.investment_case_id;
      end if;
    end if;

    return new;
  end
  $fn$;
drop trigger if exists trg_icdecisions_apply on ic_decisions;
create trigger trg_icdecisions_apply after insert on ic_decisions
  for each row execute function app.apply_ic_decision();

-- ---- A decision is a minute, not a draft -----------------------------------
-- What was decided, on what, and when cannot change. The written-up parts
-- (conditions, rationale, follow-up) can be tidied after the meeting, because
-- minutes genuinely are. Deletion is refused outright.
create or replace function app.guard_ic_decision() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    amendable text[] := array['conditions', 'rationale', 'follow_up', 'decision_makers'];
  begin
    if tg_op = 'DELETE' then
      raise exception 'Investment committee decision % is a permanent record', old.decision_id;
    end if;
    if (to_jsonb(old) - amendable) <> (to_jsonb(new) - amendable) then
      raise exception 'Investment committee decision % cannot be altered; record a new decision instead',
        old.decision_id;
    end if;
    return new;
  end
  $fn$;
drop trigger if exists trg_icdecisions_guard on ic_decisions;
create trigger trg_icdecisions_guard before update or delete on ic_decisions
  for each row execute function app.guard_ic_decision();

-- ============================================================================
-- 7. Publication provenance
-- ----------------------------------------------------------------------------
-- The publication boundary is NOT rebuilt. A version remains an independent
-- snapshot with no live relationship to the opportunity, and editing an
-- opportunity still cannot reach a published investor version.
--
-- What is added is admin-only provenance: which underwriting version and which
-- IC decision were live at the moment the draft was captured. Without it,
-- "which numbers did the investor actually see approved?" is answerable only by
-- date arithmetic. Both are nullable and ON DELETE SET NULL: provenance must
-- never be able to block or alter a publication.
-- ============================================================================
alter table publication_version_sources
  add column if not exists source_investment_case_id uuid
    references investment_cases(case_id) on delete set null,
  add column if not exists source_ic_decision_id uuid
    references ic_decisions(decision_id) on delete set null;

-- ============================================================================
-- 8. RLS and privileges
-- ----------------------------------------------------------------------------
-- Identical posture to every other internal table (0002, 0003): org-scoped
-- read, org-scoped-and-writable write, `anon` revoked. No permission is
-- broadened and no investor-facing policy is touched.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['opportunity_documents', 'opportunity_dd_items',
                           'opportunity_risks', 'ic_decisions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (app.has_org(org_id) and app.can_write())', t, t);
    -- 0007 removed anon's stock grants and fixed the default; belt and braces.
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- ============================================================================
-- 9. Function privileges
-- ----------------------------------------------------------------------------
-- 0007 revoked EXECUTE on every function then in `app`, and revoked USAGE on
-- the schema — but it set ALTER DEFAULT PRIVILEGES only for schema `public`.
-- So every function a LATER migration creates in `app` is still born with
-- PUBLIC EXECUTE, which is how the four trigger functions above arrived
-- executable by anybody. The repository's own privilege test caught it.
--
-- Revoke on what exists, and fix the default so the next migration to add a
-- function in `app` does not reopen the same hole. Schema USAGE is already
-- denied, so this is defence in depth rather than the only barrier — which is
-- exactly the posture 0007 argued for.
-- ============================================================================
revoke execute on all functions in schema app from public, anon;

do $$
declare r text;
begin
  foreach r in array array['postgres', current_user] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'alter default privileges for role %I in schema app revoke execute on functions from public, anon',
        r);
    end if;
  end loop;
end $$;
