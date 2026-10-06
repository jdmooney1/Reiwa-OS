-- ============================================================================
-- 0031 - Japanese translation of the Investor Teaser: where an accepted
--        translation lives, and the record of what a model drafted
-- ----------------------------------------------------------------------------
-- A DRAFTER THAT A PERSON OVERRULES, NOT A WRITER. A model produces a first-pass
-- Japanese rendering of the Teaser's sections; nothing it produces is kept until
-- a Reiwa administrator accepts a section (as it stands, or after editing it).
-- Generation writes only memo_translation_drafts. Acceptance is a separate, explicit
-- act and the only thing that writes memos.ja_overrides.
--
--   memos.ja_overrides       what a person accepted, per Teaser section, in Japanese.
--                            The same shape as `overrides` (section key -> plain text),
--                            kept in its own column so Japanese text can never be
--                            mistaken for, or overwrite, the English a section carries.
--                            Only the Teaser's seven section keys are allowed.
--   memo_translation_drafts  one row per generation call: the English source and the
--                            Japanese draft for every section sent, the model, who ran
--                            it, and which sections were ever saved from it.
--
-- THE GUARD DOES CHANGE, ONE WORD. app.guard_memo (0023) lists the columns a DRAFT may
-- change - 'content', 'overrides', 'composed_at' - and refuses any other change as an
-- alteration of the memo's identity. A new column is therefore NOT free: without this
-- the first accepted translation would be rejected. The function below is 0023's, with
-- 'ja_overrides' added to that list and nothing else. A FINAL memo is untouched by the
-- change: any update to it is still refused, so an accepted translation is frozen at
-- finalisation exactly as the English is, and the finalising update still changes the
-- stamp and nothing else (tests/unit/memo-translation-boundaries.test.ts holds the
-- two functions to "identical but for that one line").
--
-- NOT CARRIED TO A NEW VERSION. createMemoDraft copies `overrides` forward because the
-- English a person wrote is the part that costs effort. A Japanese translation is a
-- rendering OF that English, and the English can change in the new version: a carried
-- translation would go on reading as current after the text beneath it had moved. So a
-- new version starts with no Japanese, and the translation is drafted again. (A later
-- change can carry it forward with a staleness check; nothing here forecloses that.)
--
-- AUDIT. memo_translation_drafts is ADMINISTRATOR ONLY. What was generated is
-- append-only: an administrator may insert and read, and may update ONE column,
-- accepted_sections (a column-level grant), because "which parts did a human actually
-- keep" has to be recorded after the fact. Nothing else in a row can change and no row
-- can be deleted through the application connection.
-- ============================================================================

-- ---- Where an accepted translation lives -------------------------------------
alter table memos add column if not exists ja_overrides jsonb not null default '{}'::jsonb;

alter table memos drop constraint if exists memos_ja_overrides_shape;
alter table memos add constraint memos_ja_overrides_shape check (
  jsonb_typeof(ja_overrides) = 'object'
  -- Only the Teaser's own sections: removing the seven allowed keys must leave nothing.
  and ja_overrides - array['executive_summary', 'key_metrics', 'asset_overview', 'location_market',
                           'investment_thesis', 'business_plan', 'exit_strategy'] = '{}'::jsonb
);

comment on column memos.ja_overrides is
  'Accepted Japanese text per Investor Teaser section (section key -> plain text). Written only by an administrator accepting a drafted translation; frozen at finalisation like every other column of a final memo.';

-- ---- The guard: 0023's function with ja_overrides editable on a draft --------
create or replace function app.guard_memo() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    editable  text[] := array['content', 'overrides', 'ja_overrides', 'composed_at'];
    finalising text[] := array['status', 'finalized_by', 'finalized_at'];
  begin
    if tg_op = 'DELETE' then
      if old.status = 'final' then
        raise exception 'Memo % is final and cannot be deleted', old.memo_id;
      end if;
      return old;
    end if;

    if old.status = 'final' then
      raise exception 'Memo % is final and cannot be altered; create a new version instead', old.memo_id;
    end if;

    if new.status = 'final' then
      -- Finalising changes the stamp and nothing else: what is frozen is exactly
      -- what was saved and read.
      if (to_jsonb(old) - finalising) <> (to_jsonb(new) - finalising) then
        raise exception 'Memo % must be finalised without changing its content', old.memo_id;
      end if;
    else
      -- A draft keeps its identity; only the composed content and the human
      -- overrides move.
      if (to_jsonb(old) - editable) <> (to_jsonb(new) - editable) then
        raise exception 'Memo % identity cannot be altered; only content and overrides change while a draft', old.memo_id;
      end if;
    end if;
    return new;
  end
  $fn$;

-- CREATE OR REPLACE keeps the existing trigger and privileges; say the privilege again
-- so this migration is self-evidently safe on its own.
revoke execute on function app.guard_memo() from public, anon, authenticated;

-- ---- What a model drafted ----------------------------------------------------
create table if not exists memo_translation_drafts (
  draft_id          uuid primary key default gen_random_uuid(),
  memo_id           uuid not null references memos(memo_id) on delete cascade,
  model             text not null check (char_length(btrim(model)) between 1 and 200),
  -- {section_key: {source, draft}} for every section sent: the English that was
  -- translated and the Japanese that came back, as returned.
  sections          jsonb not null check (jsonb_typeof(sections) = 'object'),
  created_by        uuid references profiles(user_id),
  created_at        timestamptz not null default now(),
  -- The section keys ever saved from this draft: what a person kept, never what was merely generated.
  accepted_sections jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_sections) = 'array')
);

create index if not exists idx_memo_translation_drafts_memo on memo_translation_drafts(memo_id, created_at desc);

comment on table memo_translation_drafts is
  'One row per Japanese-translation generation over a draft Teaser. Records the model, the English source and Japanese draft per section, and which sections an administrator later accepted. Generating writes only here; acceptance is a separate act. Administrator-only; append-only except accepted_sections.';

alter table memo_translation_drafts enable row level security;

drop policy if exists memo_translation_drafts_admin_read on memo_translation_drafts;
create policy memo_translation_drafts_admin_read on memo_translation_drafts for select to authenticated
  using (app.is_admin());
drop policy if exists memo_translation_drafts_admin_write on memo_translation_drafts;
create policy memo_translation_drafts_admin_write on memo_translation_drafts for insert to authenticated
  with check (app.is_admin());
drop policy if exists memo_translation_drafts_admin_accept on memo_translation_drafts;
create policy memo_translation_drafts_admin_accept on memo_translation_drafts for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Supabase's stock default privileges hand `anon` rights on every new table in
-- `public`; take them back and grant only what is used (0005, 0006, 0029, 0030).
revoke all on memo_translation_drafts from anon, public;
revoke all on memo_translation_drafts from authenticated;
grant select, insert on memo_translation_drafts to authenticated;
grant update (accepted_sections) on memo_translation_drafts to authenticated;
