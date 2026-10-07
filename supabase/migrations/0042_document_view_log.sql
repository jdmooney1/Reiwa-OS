-- ============================================================================
-- 0042 — document_view_log (schema only — inert until Session 4)
-- ----------------------------------------------------------------------------
-- Nothing writes to this table yet. It exists now because docs/24 Session 2
-- scope includes it, but the actual delivery path (through the investor
-- portal's entitlement/signed-URL mechanism, or through deal_shares for a
-- prospect — Session 1 decisions §2.6/§2.7) is Session 4 work.
--
-- DEVIATION FROM THE ORIGINAL BRIEF, FLAGGED: the brief's target shape
-- included `ip` and `user_agent` columns. Dropped. This codebase has a
-- deliberate, tested rule against capturing either for any activity log —
-- `investor_activity_events` (0005/P5) and `deal_share_views` (0029) both
-- explicitly carry neither, and docs/02 §P5 asserts it both ways including
-- against `information_schema`. Adding them here would be the first crack in
-- a line the rest of the codebase holds. Raise it with me if the fee-
-- protection use case genuinely needs them — I'd want that to be a deliberate
-- call, not a column copied from the brief without noticing the conflict.
--
-- A viewer is either a mandated investor contact or a prospect via a
-- deal_shares link — never both, never neither (CHECK below). Admin-read only;
-- no investor-facing or prospect-facing policy exists, matching the posture
-- of every other activity/view table in this codebase.
-- ============================================================================

create table if not exists document_view_log (
  log_id               uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(org_id) on delete cascade,
  deal_document_id     uuid not null references deal_document(deal_document_id) on delete cascade,
  document_version_id  uuid not null references document_version(version_id) on delete cascade,
  investor_contact_id  uuid references investor_contacts(investor_contact_id) on delete set null,
  share_id             uuid references deal_shares(share_id) on delete set null,
  action               text not null check (action in ('view', 'download')),
  at                   timestamptz not null default now(),

  constraint document_view_log_one_viewer check (
    (investor_contact_id is not null)::int + (share_id is not null)::int = 1
  )
);
create index if not exists idx_document_view_log_document on document_view_log(deal_document_id, at desc);
create index if not exists idx_document_view_log_version on document_view_log(document_version_id);

comment on table document_view_log is
  'Per-version view/download log for deal_document delivery. Inert until Session 4 wires an actual delivery path. No IP or user agent — see migration header.';

alter table document_view_log enable row level security;

drop policy if exists document_view_log_select on document_view_log;
create policy document_view_log_select on document_view_log for select to authenticated
  using (app.has_org(org_id));
drop policy if exists document_view_log_insert on document_view_log;
create policy document_view_log_insert on document_view_log for insert to authenticated
  with check (app.has_org(org_id));
-- No update/delete policy for any role — append-only, same posture as every
-- other activity/view table (investor_activity_events, deal_share_views).
-- INSERT policy is deliberately permissive (not restricted to can_write())
-- because Session 4's write path is not yet designed — revisit then.

revoke all on document_view_log from anon, public;
grant select, insert on document_view_log to authenticated;

-- ROLLBACK:
--   drop table if exists document_view_log;
