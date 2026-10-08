-- ============================================================================
-- 0048 — I1: opportunities.stage -> acquired requires Stage-4 clearance
-- ----------------------------------------------------------------------------
-- Deferred from 0045 for exactly the reason its header documents: shipping
-- this earlier would have broken `convertToAsset()` (src/lib/data/
-- conversion.ts), which already ran `update opportunities set stage =
-- 'acquired'` as live, tested functionality, before anything existed to
-- write the clearance this trigger requires. Session 3 updates conversion.ts
-- to call the gate evaluator and write that clearance itself, in the SAME
-- change — see that file.
--
-- Same shape as app.guard_document_stage_column() (0045): an existence
-- check against the `stage_transition` clearance record, never a
-- re-derivation of the gate logic that produced it.
--
-- Scoped to `document_stage > 0` at the moment this migration runs.
-- SUPERSEDED by 0050: that exemption was too wide (ANY opportunity, including
-- a brand-new one, could skip the readiness tracker by simply never
-- advancing document_stage, and convert with no clearance at all). 0050
-- redefines this same function to key off `opportunities.legacy_exempt`
-- instead — a fact about the specific opportunity rather than a side effect
-- of a column it never happened to touch — once that column exists. Left
-- as originally written here so this migration still applies cleanly on its
-- own, in order; the final behaviour is 0050's.
-- ============================================================================

create or replace function app.guard_opportunity_stage_acquired() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    has_clearance boolean;
  begin
    if new.stage = 'acquired' and old.stage is distinct from 'acquired' and new.document_stage > 0 then
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

drop trigger if exists trg_opportunity_stage_acquired on opportunities;
create trigger trg_opportunity_stage_acquired before update on opportunities
  for each row execute function app.guard_opportunity_stage_acquired();

-- ROLLBACK:
--   drop trigger if exists trg_opportunity_stage_acquired on opportunities;
--   drop function if exists app.guard_opportunity_stage_acquired();
