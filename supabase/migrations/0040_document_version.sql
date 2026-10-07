-- ============================================================================
-- 0040 — document_version
-- ----------------------------------------------------------------------------
-- Versions, not edits. Every render or upload is a new row; `deal_document`
-- names which one is current. Immutability follows `app.guard_memo` (0023)
-- exactly: once `locked_at` is set (final/signed), the row cannot change or
-- be deleted — a correction is a new version, never an edit in place.
--
-- `generated_from_snapshot` is the rendered content actually used (the
-- filtered/redacted memo output for the five memo-backed types, or the
-- template-fill input for the rest) — a copy, never a live join, same rule
-- memos already follow ("content is a copy and not a live join").
-- `source_memo_id`/`source_memo_version` are provenance only: which memo and
-- version this was rendered from, for audit, not something a gate reads
-- instead of this row's own status.
-- ============================================================================

create table if not exists document_version (
  version_id       uuid primary key default gen_random_uuid(),
  deal_document_id uuid not null references deal_document(deal_document_id) on delete cascade,
  version_no       int not null,
  language         text not null check (language in ('EN', 'JA')),
  is_governing     boolean not null default true,
  -- Meaningful for non-governing JA versions only (rule: a JA version of a
  -- legal/contractual document is convenience_translation unless explicitly
  -- marked governing, and is never auto-marked final — enforced in Session 3
  -- app logic, not here; the column exists so that rule has somewhere to live).
  translation_status text check (translation_status in ('convenience_translation', 'reviewed')),

  file_url  text,
  sha256    text check (sha256 ~ '^[0-9a-f]{64}$'),

  template_key     text,
  template_version text,
  generated_from_snapshot jsonb,

  -- Provenance only for the memo-backed doc types (docs/24 §C). Nullable;
  -- null for everything else (template_fill, manual_upload, Commission/Receive).
  source_memo_id      uuid references memos(memo_id),
  source_memo_version int,

  created_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  -- Set once, when the version becomes final or signed. NULL = still editable.
  locked_at  timestamptz,

  constraint document_version_unique_no unique (deal_document_id, version_no)
);
create index if not exists idx_document_version_document on document_version(deal_document_id, version_no desc);

alter table deal_document
  add constraint deal_document_current_version_fkey
    foreign key (current_version_id) references document_version(version_id) on delete set null;

comment on column deal_document.current_version_id is
  'Set by application code when a version becomes the one shown by default — not auto-maintained by a trigger. Semantics ("latest draft" vs "latest final") are Session 3 app logic.';

-- ---- Immutability once locked -----------------------------------------------
create or replace function app.guard_document_version() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'DELETE' then
      if old.locked_at is not null then
        raise exception 'document_version % is locked (final/signed) and cannot be deleted', old.version_id;
      end if;
      return old;
    end if;
    if old.locked_at is not null then
      raise exception 'document_version % is locked (final/signed) and cannot be changed; create a new version instead', old.version_id;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_document_version_guard on document_version;
create trigger trg_document_version_guard before update or delete on document_version
  for each row execute function app.guard_document_version();

-- ---- RLS ----------------------------------------------------------------
alter table document_version enable row level security;

drop policy if exists document_version_select on document_version;
create policy document_version_select on document_version for select to authenticated
  using (exists (
    select 1 from deal_document dd
     where dd.deal_document_id = document_version.deal_document_id
       and app.has_org(dd.org_id)
  ));
drop policy if exists document_version_insert on document_version;
create policy document_version_insert on document_version for insert to authenticated
  with check (app.can_write() and exists (
    select 1 from deal_document dd
     where dd.deal_document_id = document_version.deal_document_id
       and app.has_org(dd.org_id)
  ));
drop policy if exists document_version_update on document_version;
create policy document_version_update on document_version for update to authenticated
  using (app.can_write() and exists (
    select 1 from deal_document dd
     where dd.deal_document_id = document_version.deal_document_id
       and app.has_org(dd.org_id)
  ))
  with check (app.can_write() and exists (
    select 1 from deal_document dd
     where dd.deal_document_id = document_version.deal_document_id
       and app.has_org(dd.org_id)
  ));
drop policy if exists document_version_delete on document_version;
create policy document_version_delete on document_version for delete to authenticated
  using (app.can_write() and exists (
    select 1 from deal_document dd
     where dd.deal_document_id = document_version.deal_document_id
       and app.has_org(dd.org_id)
  ));

revoke all on document_version from anon, public;
grant select, insert, update, delete on document_version to authenticated;

-- ROLLBACK:
--   drop trigger if exists trg_document_version_guard on document_version;
--   drop function if exists app.guard_document_version();
--   alter table deal_document drop constraint if exists deal_document_current_version_fkey;
--   drop table if exists document_version;
