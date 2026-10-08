-- ============================================================================
-- 0046 — I7: post-close amendment guard
-- ----------------------------------------------------------------------------
-- Approved addition (docs/24, "I7: build it"). Once an opportunity has
-- converted (stage = 'acquired'), a new version of a Stage 0–3 catalogue
-- document — pre-close paperwork — is not a routine update; it is rewriting
-- history on a deal that has already closed. Require a logged override.
--
-- Safe to ship now: `document_version` is a brand-new table (0040) with no
-- existing writer anywhere in the application, so this cannot break anything
-- that exists today (contrast 0045's I1, which is deferred for exactly that
-- reason).
--
-- CONTRACT for whoever writes the Session 6 upload/generate action: the
-- authorising `gate_override` row (action = 'post_close_amendment') must be
-- INSERTED IN THE SAME TRANSACTION as the `document_version` insert it
-- authorises, before it. This trigger matches on `gate_override.at = now()`
-- — and `now()` is the transaction timestamp in Postgres, frozen for the
-- whole transaction, so this is exact same-transaction correlation, not a
-- time-window heuristic. An override from an earlier transaction (logged
-- ahead of time, consumed later by a separate request) does NOT satisfy
-- this check by design — a fresh override is required per amendment, so
-- authorisation can never be "spent" once and reused for every version after.
-- ============================================================================

create or replace function app.guard_post_close_document_version() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    dd record;
    dt_stage smallint;
    opp_stage text;
    has_override boolean;
  begin
    select deal_document_id, opportunity_id, deal_investor_id, doc_type_key
      into dd
      from public.deal_document
     where deal_document_id = new.deal_document_id;

    select stage into dt_stage from public.doc_type where key = dd.doc_type_key;
    select stage into opp_stage from public.opportunities where opportunity_id = dd.opportunity_id;

    if opp_stage = 'acquired' and dt_stage <= 3 then
      select exists (
        select 1 from public.gate_override go
         where go.opportunity_id = dd.opportunity_id
           and go.gate_doc_type_key = dd.doc_type_key
           and go.action = 'post_close_amendment'
           and (go.deal_investor_id is null or go.deal_investor_id = dd.deal_investor_id)
           and go.at = now()
      ) into has_override;

      if not has_override then
        raise exception
          'New version of deal_document % (doc_type %, Stage %) requires a post_close_amendment gate_override — the opportunity has already converted to an asset',
          dd.deal_document_id, dd.doc_type_key, dt_stage;
      end if;
    end if;

    return new;
  end
  $fn$;

drop trigger if exists trg_guard_post_close_document_version on document_version;
create trigger trg_guard_post_close_document_version before insert on document_version
  for each row execute function app.guard_post_close_document_version();

-- ROLLBACK:
--   drop trigger if exists trg_guard_post_close_document_version on document_version;
--   drop function if exists app.guard_post_close_document_version();
