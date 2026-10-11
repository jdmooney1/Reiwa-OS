-- ============================================================================
-- 0036 - Deal assessments: the engine's numbers for one underwriting version,
--        and (optionally) a model's judgement written over them
-- ----------------------------------------------------------------------------
-- WHAT A ROW IS. One run of the assessment engine (src/lib/underwrite) against an
-- opportunity's investment case as it stood at that moment:
--
--   inputs      every input the engine used and where it came from (case, rent
--               roll, property, opportunity, FX table, or a dated default).
--   results     the engine's output: annual cash flow, scenarios, hold periods,
--               reverse stress, and the proposed terms priced. Stored whole, so
--               what was shown on the day can be shown again after the engine
--               changes; a stored run is never recomputed.
--   assessment  the model's structured judgement (verdict, evidence register,
--               concerns, proposed terms as INPUTS, committee questions). NULL
--               when the run was engine-only.
--   model       the model id that wrote the assessment; NULL with it.
--
-- NUMBERS COME FROM CODE. Nothing a model writes is a figure: the assessment's
-- schema has no field for one, and proposed terms are priced by the engine
-- before the row is written. This keeps the rule in docs/07 and docs/21.
--
-- NOT THE UNDERWRITING. Nothing here writes to investment_cases. A run reads a
-- case and records what it found; revising the case is still a new version.
--
-- APPEND-ONLY. No update or delete policy, and `authenticated` is granted SELECT
-- and INSERT only: "what did the assessment say before the IC" must have one
-- answer later. Rows follow their opportunity on delete.
--
-- REIWA STAFF ONLY, AND ORGANISATION-SCOPED. Both policies require app.is_staff()
-- (the same posture as the memo drafting aids in 0035) AND app.has_org(org_id):
-- a client organisation's own users can see its pipeline, but an assessment is
-- Reiwa's internal committee view and is not theirs to read or write. No
-- investor, prospect or portal surface reads this table.
--
-- WHO AND WHEN ARE NOT THE CALLER'S TO SAY. The insert trigger stamps created_at
-- with now() and refuses a created_by that is not the signed-in user, so a run
-- cannot be backdated or attributed to a colleague.
-- ============================================================================
create table if not exists deal_assessments (
  assessment_id  uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  -- The underwriting version it read. NULL when the deal had no case yet and the
  -- engine ran on the opportunity's own figures.
  case_id        uuid,
  tier           text not null check (tier in ('lease', 'screen')),
  engine_version int  not null check (engine_version >= 1),
  inputs         jsonb not null check (jsonb_typeof(inputs) = 'array'),
  results        jsonb not null check (jsonb_typeof(results) = 'object'),
  assessment     jsonb check (assessment is null or jsonb_typeof(assessment) = 'object'),
  model          text check (model is null or char_length(btrim(model)) between 1 and 200),
  verdict        text check (verdict is null or verdict in ('proceed', 'proceed_at_price', 'pass')),
  created_by     uuid not null references profiles(user_id),
  created_at     timestamptz not null default now(),

  -- The case must belong to the opportunity it is recorded against (0008 made
  -- (case_id, opportunity_id) unique for exactly this kind of reference).
  -- Deleting a draft case keeps its runs (append-only) and forgets which
  -- version they read; only the case id is cleared.
  constraint deal_assessments_case_fkey
    foreign key (case_id, opportunity_id)
    references investment_cases(case_id, opportunity_id) on delete set null (case_id),
  -- An assessment, its model and its verdict arrive together or not at all.
  constraint deal_assessments_model_with_assessment
    check ((assessment is null) = (model is null) and (assessment is null) = (verdict is null))
);

create index if not exists idx_deal_assessments_opp on deal_assessments(opportunity_id, created_at desc);

comment on table deal_assessments is
  'One run of the deal assessment engine (src/lib/underwrite) over an opportunity, with an optional structured model assessment. Figures come from code; the assessment is judgement and carries no figures. Append-only, organisation-scoped. Never written back to investment_cases.';

-- The organisation on a row is the organisation of its opportunity, always; the
-- author is the signed-in user and the time is now.
create or replace function app.deal_assessments_org() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare o uuid;
  begin
    select org_id into o from public.opportunities where opportunity_id = new.opportunity_id;
    if o is null or o <> new.org_id then
      raise exception 'Assessment organisation does not match its opportunity';
    end if;
    if auth.uid() is not null and new.created_by is distinct from auth.uid() then
      raise exception 'An assessment is recorded by the signed-in user';
    end if;
    new.created_at := now();
    return new;
  end;
  $fn$;
revoke execute on function app.deal_assessments_org() from public, anon, authenticated;
drop trigger if exists trg_deal_assessments_org on deal_assessments;
create trigger trg_deal_assessments_org before insert on deal_assessments
  for each row execute function app.deal_assessments_org();

alter table deal_assessments enable row level security;

drop policy if exists deal_assessments_select on deal_assessments;
create policy deal_assessments_select on deal_assessments for select to authenticated
  using (app.is_staff() and app.has_org(org_id));
drop policy if exists deal_assessments_insert on deal_assessments;
create policy deal_assessments_insert on deal_assessments for insert to authenticated
  with check (app.is_staff() and app.has_org(org_id) and app.can_write());

-- Supabase's default privileges hand `anon` rights on every new table; take them
-- back and grant only what is used (0005, 0006, 0029, 0030).
revoke all on deal_assessments from anon, public;
revoke all on deal_assessments from authenticated;
grant select, insert on deal_assessments to authenticated;
