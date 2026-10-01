-- ============================================================================
-- 0023 - Investment memos
-- ----------------------------------------------------------------------------
-- A memo is the document a decision is made on, or sent to investors on. It is
-- composed DETERMINISTICALLY from real rows (src/lib/memo/compose.ts) and stored
-- as a snapshot; nothing about it is written by a model, and a section with no
-- backing data is stored as visibly empty, never filled.
--
--   content    the composed sections, as structured data (not prose), plus the
--              basis they were composed from. A COPY, not a live join: a later
--              underwriting revision must not change a memo that was finalised.
--   overrides  per-section text a person wrote, keyed by section. Kept apart from
--              `content` on purpose so the record always says which text was
--              composed from rows and which was typed by a human. An override
--              supersedes the composed section when it is rendered; it never
--              replaces it in the record.
--
-- VERSIONING is underwriting's: a revision is a NEW ROW (version + 1), never an
-- edit of a final one. At most one draft exists per opportunity (a partial unique
-- index), so "the memo being worked on" has one answer by construction.
--
-- A FINAL MEMO IS IMMUTABLE, in the database. Same reasoning and same style as
-- ic_decisions (0008): a trigger, not application discipline. A draft may change
-- only `content`, `overrides` and `composed_at`; it becomes final by one update
-- that changes nothing but status and the finalisation stamp, so what is frozen
-- is exactly what was saved and shown. A final row can be neither updated nor
-- deleted.
--
-- INTERNAL ONLY. Same posture as every internal table (0003, 0008): org-scoped
-- read, org-scoped-and-writable write, `anon` revoked, and NO investor policy.
-- A memo reaches an investor only as a document a person chose to send.
-- ============================================================================
create table if not exists memos (
  memo_id        uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,

  version        int  not null check (version >= 1),
  status         text not null default 'draft' check (status in ('draft', 'final')),

  content        jsonb not null,
  overrides      jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(overrides) = 'object'),
  composed_at    timestamptz not null default now(),

  created_by     uuid not null references profiles(user_id),
  created_at     timestamptz not null default now(),
  finalized_by   uuid references profiles(user_id),
  finalized_at   timestamptz,

  unique (opportunity_id, version),
  -- Final means stamped, draft means not: the two cannot disagree.
  constraint memos_final_stamp check (
    (status = 'final' and finalized_by is not null and finalized_at is not null)
    or (status = 'draft' and finalized_by is null and finalized_at is null))
);

comment on table memos is
  'Composed investment memos (versioned, one draft at a time, immutable once final). content = composed sections as data; overrides = per-section human text, kept separate so composed and typed text stay distinguishable.';

create unique index if not exists memos_single_draft
  on memos(opportunity_id) where status = 'draft';
create index if not exists idx_memos_opportunity on memos(opportunity_id, version desc);

-- ---- Immutability -----------------------------------------------------------
create or replace function app.guard_memo() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    editable  text[] := array['content', 'overrides', 'composed_at'];
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
drop trigger if exists trg_memos_guard on memos;
create trigger trg_memos_guard before update or delete on memos
  for each row execute function app.guard_memo();

-- The 0007 default no longer reaches new functions, so say it explicitly: a
-- trigger function is never called directly and nobody needs EXECUTE on it.
revoke execute on function app.guard_memo() from public, anon, authenticated;

-- ---- RLS and privileges -----------------------------------------------------
alter table memos enable row level security;

drop policy if exists memos_select on memos;
create policy memos_select on memos for select to authenticated
  using (app.has_org(org_id));
drop policy if exists memos_insert on memos;
create policy memos_insert on memos for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists memos_update on memos;
create policy memos_update on memos for update to authenticated
  using (app.has_org(org_id) and app.can_write())
  with check (app.has_org(org_id) and app.can_write());
-- Delete is allowed by policy for drafts only; the trigger refuses a final one.
drop policy if exists memos_delete on memos;
create policy memos_delete on memos for delete to authenticated
  using (app.has_org(org_id) and app.can_write() and status = 'draft');

revoke all on memos from anon, public;
grant select, insert, update, delete on memos to authenticated;
