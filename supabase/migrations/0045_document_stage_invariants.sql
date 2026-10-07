-- ============================================================================
-- 0045 — document_stage invariants (I2, I3, I4 — I1 ships in Session 3)
-- ----------------------------------------------------------------------------
-- Per the approved revision to docs/24 §A: NONE of this re-implements the
-- Session 3 gate evaluator. Every check below is either (a) an existence
-- check against the `stage_transition` clearance record 0041 defined, or
-- (b) a single, specific hard fact (an approved IC decision; the opportunity
-- isn't dead) that was never catalogue-driven gate logic to begin with.
--
-- IMPLEMENTATION FINDING, not in the approved plan text: I1 ("opportunities
-- .stage cannot become acquired without a recorded Stage-4 clearance") is NOT
-- added here. `src/lib/data/conversion.ts:139` already runs
-- `update opportunities set stage = 'acquired' ...` TODAY, as live, tested
-- functionality (docs/10's manual E2E walk, tests/lifecycle.test.ts) — and
-- nothing in Session 2 writes a qualifying `stage_transition` row, because
-- the evaluator that would ever legitimately write one doesn't exist until
-- Session 3. Shipping I1 now would brick "Convert to Asset" for every
-- opportunity between this migration and Session 3 landing — a direct breach
-- of rule 3 ("don't break existing features"). I1 ships in Session 3's own
-- migration, landing in the SAME change that updates `conversion.ts` to
-- write the clearance record it now requires. Flagging this explicitly
-- rather than silently deferring it.
--
-- What IS safe to ship now: I2 and I3 (checked at clearance-insert time,
-- below) and I4 plus the document_stage lock-step rule (checked when
-- `opportunities.document_stage` itself changes). Nothing in the running
-- application writes `document_stage` yet — it is a new column, default 0,
-- untouched by any existing code path — so this half cannot break anything
-- that exists today.
--
--   1. Facts checked when a `stage_transition` CLEARANCE row is inserted —
--      I2 (ic_decisions) and I3 (opportunity not dead). These apply to the
--      clearance-granting act itself, unconditionally — even an override
--      cannot grant clearance to Hold without a real IC approval, and even
--      an override has no reason to advance readiness on a dead deal.
--   2. Facts checked when `document_stage` itself changes — I4
--      (document_stage -> 4 needs stage already = acquired) plus the general
--      rule that document_stage may only move in lock-step with an existing
--      matching clearance row.
-- ============================================================================

-- ---- Group 1: facts checked at clearance time -------------------------------
create or replace function app.guard_stage_transition_facts() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    opp record;
    has_approved_ic boolean;
  begin
    select stage, status into opp from public.opportunities where opportunity_id = new.opportunity_id;

    -- I2: clearance into Hold (stage 4) always needs an approved IC decision,
    -- override or not — this is not a document-readiness gate to override,
    -- it is the fact that the IC approved the investment at all. Also the
    -- gate condition behind the final_ic_memo doc_type (docs/24 §D,
    -- gate_condition = 'requires_ic_decision') — enforced here too, as
    -- deliberate defence in depth, not a second implementation: the Session 3
    -- evaluator decides whether final_ic_memo's OWN gate is satisfied; this
    -- trigger only re-asserts the one fact that must hold regardless.
    if new.to_stage = 4 then
      select exists (
        select 1 from public.ic_decisions ic
         where ic.opportunity_id = new.opportunity_id
           and ic.outcome in ('approved', 'approved_with_conditions')
      ) into has_approved_ic;
      if not has_approved_ic then
        raise exception
          'Cannot clear opportunity % into Hold (Stage 4): no approved IC decision exists',
          new.opportunity_id;
      end if;
    end if;

    -- I3: forward clearance is refused on a dead deal (rejected/withdrawn/
    -- lost) regardless of override — there is no business reason to advance
    -- document readiness on an opportunity that is not active.
    if new.to_stage > new.from_stage and opp.status <> 'active' then
      raise exception
        'Cannot grant forward stage clearance for opportunity % (status "%" is not active)',
        new.opportunity_id, opp.status;
    end if;

    return new;
  end
  $fn$;

drop trigger if exists trg_stage_transition_facts on stage_transition;
create trigger trg_stage_transition_facts before insert on stage_transition
  for each row execute function app.guard_stage_transition_facts();

-- ---- Group 2: facts checked when document_stage itself changes -------------
-- I1 (opportunities.stage -> acquired requires Stage-4 clearance) is NOT
-- here — see the migration header. It is added by a Session 3 migration,
-- as a second trigger on `opportunities` alongside this one, once
-- conversion.ts writes the clearance it will require.
create or replace function app.guard_document_stage_column() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    has_clearance boolean;
  begin
    if new.document_stage is distinct from old.document_stage then
      -- document_stage may only move in lock-step with an already-recorded
      -- clearance for that exact transition. The clearance row must already
      -- exist (written by the Session 3 evaluator, in an earlier statement
      -- of the same or a prior transaction) — this trigger never grants one.
      select exists (
        select 1 from public.stage_transition st
         where st.opportunity_id = new.opportunity_id
           and st.from_stage = old.document_stage
           and st.to_stage = new.document_stage
      ) into has_clearance;
      if not has_clearance then
        raise exception
          'opportunities.document_stage (%) cannot move from % to % without a matching stage_transition clearance record',
          new.opportunity_id, old.document_stage, new.document_stage;
      end if;

      -- I4: Hold (document_stage 4) presupposes the deal has actually
      -- completed. Checked against NEW.stage so a single statement that sets
      -- both columns together still sees the intended final value.
      if new.document_stage = 4 and new.stage <> 'acquired' then
        raise exception
          'opportunities.document_stage cannot reach 4 (Hold) before opportunities.stage = acquired (opportunity %)',
          new.opportunity_id;
      end if;
    end if;

    return new;
  end
  $fn$;

drop trigger if exists trg_guard_document_stage_column on opportunities;
create trigger trg_guard_document_stage_column before update on opportunities
  for each row execute function app.guard_document_stage_column();

-- ROLLBACK:
--   drop trigger if exists trg_guard_document_stage_column on opportunities;
--   drop function if exists app.guard_document_stage_column();
--   drop trigger if exists trg_stage_transition_facts on stage_transition;
--   drop function if exists app.guard_stage_transition_facts();
