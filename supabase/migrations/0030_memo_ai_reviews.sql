-- ============================================================================
-- 0030 - Pre-finalisation review: what a model was asked to look at, and what
--        it said back
-- ----------------------------------------------------------------------------
-- A REVIEWER, NOT AN AUTHOR. Migration 0023 says of a memo that "nothing about
-- it is written by a model", and that stays exactly true: nothing here writes to
-- memos.content or memos.overrides, and no row in this table is ever read back
-- into a memo. A review is a list of things worth a person's attention before
-- they finalise - held beside the memo, never inside it.
--
-- It is also NOT A GATE. No finding blocks finalisation; app.guard_memo and the
-- finalisation path are untouched by this migration. A model's false positive
-- must never be able to hold up a deal, so the control stays human judgement and
-- this table stays a record of advice given.
--
--   findings  the structured list that came back, as returned. Stored whole so
--             "what did the review actually say" has one answer later, and kept
--             as data (label, sections, reason, category) rather than prose.
--   model     the model id that produced it. A review is only interpretable
--             against the thing that wrote it.
--
-- APPEND-ONLY. One row per review run, and that row is the record of what was
-- said at that moment: there is no update policy and no delete policy, and
-- `authenticated` is granted SELECT and INSERT and nothing else. Same reasoning
-- as deal_share_views (0029) - "was this memo reviewed before it went out, and
-- what did the review say" is only worth asking if the answer cannot be tidied
-- afterwards. A review is kept when its memo is deleted only insofar as the memo
-- can be deleted at all (a draft); the cascade follows the memo.
--
-- ADMIN ONLY, and that is the whole posture: app.is_admin() on both policies,
-- no org-scoped staff policy, no investor policy, no prospect policy, nothing
-- for anon. This is a staff tool and its output reaches no reader outside the
-- Reiwa administrators who ran it.
-- ============================================================================
create table if not exists memo_ai_reviews (
  review_id  uuid primary key default gen_random_uuid(),
  memo_id    uuid not null references memos(memo_id) on delete cascade,
  model      text not null check (char_length(btrim(model)) between 1 and 200),
  findings   jsonb not null check (jsonb_typeof(findings) = 'array'),
  created_by uuid references profiles(user_id),
  created_at timestamptz not null default now()
);

create index if not exists idx_memo_ai_reviews_memo on memo_ai_reviews(memo_id, created_at desc);

comment on table memo_ai_reviews is
  'One row per pre-finalisation review run over a composed memo. Advisory only: findings are things for a person to check, never a verdict, never a gate on finalisation, and never written back into memos.content or memos.overrides. Append-only, administrator-only.';

alter table memo_ai_reviews enable row level security;

-- Read and write for administrators; no other policy exists, so there is no
-- route to this table for staff, investors or prospects.
drop policy if exists memo_ai_reviews_admin_read on memo_ai_reviews;
create policy memo_ai_reviews_admin_read on memo_ai_reviews for select to authenticated
  using (app.is_admin());
drop policy if exists memo_ai_reviews_admin_write on memo_ai_reviews;
create policy memo_ai_reviews_admin_write on memo_ai_reviews for insert to authenticated
  with check (app.is_admin());

-- Supabase's stock default privileges hand `anon` rights on every new table in
-- `public`; take them back and grant only what is used (0005, 0006, 0029).
revoke all on memo_ai_reviews from anon, public;
revoke all on memo_ai_reviews from authenticated;
grant select, insert on memo_ai_reviews to authenticated;
