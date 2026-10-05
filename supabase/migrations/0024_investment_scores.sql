-- ============================================================================
-- 0024 - Investment Score persistence
-- ----------------------------------------------------------------------------
-- The model (criteria, weights, bands, the arithmetic) lives in
-- src/lib/scoring/model.ts and is NOT stored here. A score row holds only what a
-- person decided: a score from 1 to 10 for each criterion, their commentary, and
-- whether they flag it as a risk. The overall and the recommendation band are
-- computed from those through the model, so a re-weighting applies consistently
-- to every score read back. If a score ever has to be reproducible against the
-- weights in force on the day it was recorded, VERSION THE MODEL; do not copy
-- weights onto these rows (the same reasoning that keeps an approved
-- investment_case immutable).
--
-- Two tables, as docs/06-investment-score.md specifies:
--   investment_scores            a header per recorded score
--   investment_score_categories  one row per criterion scored
--
-- APPEND-ONLY BY CONVENTION: every save is a NEW header (version + 1) with its own
-- category rows, and the latest version is the current score. What the committee
-- saw on the day is therefore never overwritten by a later re-score. The
-- application never updates or deletes a score; the four standard policies exist
-- because every internal table has them, not because anything edits in place.
--
-- A score may be saved part-way. `overall` and `recommendation` are NULL until all
-- criteria are scored, because a sum over half the criteria is not a lower score,
-- it is no score: Reject on three categories out of eleven would be a fabricated
-- verdict. The CHECK ties them together so one can never exist without the other.
--
-- There is deliberately NO `summary` column. A stored sentence was how the first
-- score screen showed a confident IC summary that had been drawn from a sample
-- string. Where a summary is shown it is composed from the real scores on read.
--
-- INTERNAL ONLY. Same posture as every internal table (0003, 0008): org-scoped
-- read, org-scoped-and-writable write, `anon` revoked, no investor policy.
-- ============================================================================
create table if not exists investment_scores (
  score_id       uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  version        int  not null check (version >= 1),

  -- Out of 100, one decimal, as computeOverall returns it. NULL until complete.
  overall        numeric(4,1) check (overall is null or (overall >= 0 and overall <= 100)),
  recommendation text check (recommendation in ('strong_proceed', 'proceed',
                                                'proceed_with_caution', 'weak', 'reject')),

  scored_by      uuid not null references profiles(user_id),
  scored_at      timestamptz not null default now(),

  unique (opportunity_id, version),
  unique (score_id, org_id),
  constraint investment_scores_complete check ((overall is null) = (recommendation is null))
);
create index if not exists idx_scores_opportunity on investment_scores(opportunity_id, version desc);

create table if not exists investment_score_categories (
  score_id     uuid not null,
  org_id       uuid not null,
  -- A key from SCORE_CATEGORIES in the model. Validated by the application, which
  -- is where the list lives; the database only keeps it well-formed.
  category_key text not null check (category_key ~ '^[a-z][a-z_]*$'),
  -- 1 to 10 in half-point steps. Higher is always better, including for the risk
  -- criteria (a high capex-risk score means LOW capex risk).
  score        numeric(3,1) not null check (score >= 1 and score <= 10 and (score * 2) = round(score * 2)),
  commentary   text,
  risk_flag    boolean not null default false,
  primary key (score_id, category_key),
  -- The organisation on a category row is the organisation of its header, always.
  foreign key (score_id, org_id) references investment_scores(score_id, org_id) on delete cascade,
  -- A flag nobody explained is a flag nobody can act on.
  constraint score_flag_explained check (not risk_flag or length(btrim(coalesce(commentary, ''))) > 0)
);

comment on table investment_scores is
  'A recorded Investment Score (append-only: a save is a new version). overall/recommendation are computed through src/lib/scoring/model.ts at save and are NULL until every criterion is scored. Weights are never stored.';
comment on table investment_score_categories is
  'One scored criterion: score 1-10 (half points), commentary, risk flag (flag requires commentary). Higher is always better.';

-- ---- RLS and privileges: the standard four, as every internal table ------------
do $$
declare t text;
begin
  foreach t in array array['investment_scores', 'investment_score_categories'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (app.has_org(org_id) and app.can_write())', t, t);
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
