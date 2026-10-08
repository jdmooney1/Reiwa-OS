-- ============================================================================
-- 0034 — Deal readiness stage (separate from the pipeline stage)
-- ----------------------------------------------------------------------------
-- `opportunities.stage` (new/screening/underwriting/ic/approved/acquired) is
-- the pipeline's own progression and is left untouched — it has real, tested
-- behaviour elsewhere (the pipeline board, scoring eligibility) and does not
-- map 1:1 onto the deal document catalogue's five stages (docs/24 §2.2):
-- Stage 2 "Soft-circled" in particular has no pipeline equivalent at all.
--
-- `document_stage` is a second, independent progression, owned entirely by
-- the gate engine (Session 3): 0 Screen, 1 Pitch-ready, 2 Soft-circled,
-- 3 Closing, 4 Hold. It is NOT gated by this migration — that is Session 3 —
-- but 0045/0046 add hard invariants tying it to `opportunities.stage`/
-- `status` and to the IC decision record, so the column exists first.
--
-- Column only. Every write to it is expected to go through the Session 3
-- transition action, which also writes the matching `stage_transition` row
-- 0045 checks for — never a bare UPDATE, the way `opportunities.stage`
-- currently is (docs/24 §2.2 audit finding).
-- ============================================================================

alter table opportunities
  add column if not exists document_stage smallint not null default 0
    check (document_stage between 0 and 4),
  add column if not exists document_stage_updated_at timestamptz;

comment on column opportunities.document_stage is
  'Deal-readiness progression for the document catalogue (0 Screen .. 4 Hold). Independent of opportunities.stage — see docs/24 §2.2. Changed only via the Session 3 transition action, which records a matching stage_transition row.';

create index if not exists idx_opportunities_document_stage
  on opportunities(org_id, document_stage) where archived_at is null;

-- ROLLBACK:
--   drop index if exists idx_opportunities_document_stage;
--   alter table opportunities drop column if exists document_stage_updated_at;
--   alter table opportunities drop column if exists document_stage;
--   -- Safe only once 0043, 0045 and 0046 (which reference this column) are
--   -- also rolled back first.
