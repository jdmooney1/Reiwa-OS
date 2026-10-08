-- ============================================================================
-- 0057 — document_view_log: the investor-session write path
-- ----------------------------------------------------------------------------
-- document_view_log (0042) shipped schema-only: its only INSERT policy is
-- app.has_org(org_id), which an investor session can never satisfy (empty
-- org_ids, not admin) — the same category of gap docs/24 already flagged for
-- app.record_doc_type_audit() (0036) and app.log_deal_investor_status_change()
-- (0038): a table whose caller cannot read what it needs to write.
--
-- This is deliberately a plain RLS policy, not a SECURITY DEFINER function
-- writing on the investor's behalf: unlike those two, every fact the WITH
-- CHECK below needs (the caller's own investor_contact_id, and whether they
-- may read the version being logged) is already answerable through existing
-- SECURITY DEFINER readers, so an ordinary authenticated INSERT, scoped this
-- tightly, is sufficient and keeps the write itself attributable to the
-- investor's own session rather than a privileged one.
--
-- An investor can only ever log their OWN view/download, of a version they
-- are actually entitled to read right now, under a (document_version,
-- deal_document, org_id) triple that is internally consistent — not a
-- mismatched set of ids assembled to point the row somewhere else.
-- ============================================================================

drop policy if exists document_view_log_investor_insert on document_view_log;
create policy document_view_log_investor_insert on document_view_log for insert to authenticated
  with check (
    investor_contact_id = app.current_investor_contact_id()
    and share_id is null
    and app.investor_may_read_document_version(document_version_id)
    and exists (
      select 1 from document_version dv
      join deal_document dd on dd.deal_document_id = dv.deal_document_id
      where dv.version_id = document_view_log.document_version_id
        and dd.deal_document_id = document_view_log.deal_document_id
        and dd.org_id = document_view_log.org_id
    )
  );

-- ROLLBACK:
--   drop policy if exists document_view_log_investor_insert on document_view_log;
