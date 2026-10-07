-- ============================================================================
-- 0036 — Document type catalogue audit history
-- ----------------------------------------------------------------------------
-- A catalogue edit is a policy change — re-gating when a document blocks a
-- stage, or retiring a document type, changes what every deal in flight is
-- held to. "Who changed what, when" needs the same answerability as an IC
-- decision, so it is captured the same way: an append-only table, written by
-- a trigger rather than by application code remembering to log it.
--
-- `doc_type_key` is NOT a foreign key to doc_type(key). History must outlive
-- the row it describes — a retired or (rare, discouraged in favour of
-- is_active = false) deleted catalogue entry keeps its audit trail rather
-- than cascading it away or blocking the delete.
-- ============================================================================

create table if not exists doc_type_audit (
  audit_id     uuid primary key default gen_random_uuid(),
  doc_type_key text not null,
  operation    text not null check (operation in ('insert', 'update', 'delete')),
  before       jsonb,
  after        jsonb,
  changed_by   uuid references profiles(user_id),
  changed_at   timestamptz not null default now()
);
create index if not exists idx_doc_type_audit_key on doc_type_audit(doc_type_key, changed_at desc);

comment on table doc_type_audit is
  'Append-only history of doc_type changes. Written only by app.record_doc_type_audit() — never by application code, so no caller can edit the catalogue without leaving a row.';

-- SECURITY DEFINER, deliberately: `authenticated` has no grant on
-- doc_type_audit at all (by design — see below), so a plain SECURITY
-- INVOKER trigger function would fail to write it. Running as the function
-- owner (the migration role) is what lets the trigger succeed regardless of
-- the firing session's own privilege — the SAME reasoning P1's investor
-- helpers give for their own SECURITY DEFINER functions (docs/12): resolving
-- something the caller's own privilege can't reach. `set search_path = ''`
-- is the mandatory companion to that, to stop a SECURITY DEFINER function
-- resolving an unqualified name against a search path the caller controls.
create or replace function app.record_doc_type_audit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'INSERT' then
      insert into public.doc_type_audit (doc_type_key, operation, before, after, changed_by)
        values (new.key, 'insert', null, to_jsonb(new), app.current_user_id()::uuid);
    elsif tg_op = 'UPDATE' then
      insert into public.doc_type_audit (doc_type_key, operation, before, after, changed_by)
        values (new.key, 'update', to_jsonb(old), to_jsonb(new), app.current_user_id()::uuid);
    elsif tg_op = 'DELETE' then
      insert into public.doc_type_audit (doc_type_key, operation, before, after, changed_by)
        values (old.key, 'delete', to_jsonb(old), null, app.current_user_id()::uuid);
      return old;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_doc_type_audit on doc_type;
create trigger trg_doc_type_audit after insert or update or delete on doc_type
  for each row execute function app.record_doc_type_audit();

alter table doc_type_audit enable row level security;

drop policy if exists doc_type_audit_select on doc_type_audit;
create policy doc_type_audit_select on doc_type_audit for select to authenticated
  using (true);
-- No insert/update/delete policy for any role: the trigger function is
-- SECURITY DEFINER (above), so its INSERT runs as the function owner
-- regardless of RLS or the firing session's own grants — and nothing else
-- may write this table, since `authenticated` has no INSERT grant on it at
-- all (below) and no policy would permit one if it did.

revoke all on doc_type_audit from anon, public;
grant select on doc_type_audit to authenticated;
-- Deliberately no INSERT/UPDATE/DELETE grant to `authenticated` here: the
-- trigger's SECURITY DEFINER status is what lets it write regardless, and
-- withholding the grant is what stops anything else from writing directly.

-- ROLLBACK:
--   drop trigger if exists trg_doc_type_audit on doc_type;
--   drop function if exists app.record_doc_type_audit();
--   drop table if exists doc_type_audit;
