-- ============================================================================
-- 0047 — Auto-create deal_document rows on stage entry / investor status
-- ----------------------------------------------------------------------------
-- Per the original brief: "Auto-create deal-scoped deal_document rows when a
-- deal enters a stage (including all prior-stage rows if a deal is created
-- mid-way). Auto-create investor-scoped rows when a deal_investor record is
-- created or advances status."
--
-- REVISED per the review answer to docs/24 §12 (the first version of this
-- migration tied investor-scoped creation to the DEAL's document_stage —
-- flagged at the time as an interpretation needing confirmation; it was not
-- what was meant). Investor-scoped rows are now created by the INVESTOR's
-- own status, per an explicit mapping on each doc_type
-- (`investor_status_trigger`, migration 0035):
--   teaser_sent    -> investor_nda
--   ioi_received   -> investor_ioi, advisory_mandate, investor_kyc,
--                     sanctions_screening_investor, abort_cost_agreement,
--                     plus ringi_pack / jp_pre_contract_disclosure where
--                     their own conditions apply (app.doc_type_applies)
--   committed      -> jp_fx_filing (corporate only, by its own condition)
-- Cumulative, not an exact-match: app.investor_status_rank orders the
-- funnel, so a deal_investor whose status jumped past an intermediate value
-- in practice (never literally set to teaser_sent, say) still gets every
-- document a lower-or-equal-ranked trigger would have created. Idempotent
-- via the same unique index every other auto-create path relies on.
--
-- On decline: still-open documents for that investor are marked
-- not_applicable (migration 0039 added the status value for this) — never
-- deleted, so what was never pursued stays part of the record.
--
-- Deal-scoped creation is UNCHANGED — still document_stage-driven.
-- ============================================================================

-- Applicability, as distinct from gating. `doc_type.gate_condition` is read
-- two ways: when `gate_kind` is transition/action, it is a condition the
-- Session 3 evaluator checks before clearing the gate; when `gate_kind` is
-- 'none' (e.g. ringi_pack, "conditional: investor_type:corporate"), the same
-- column says whether the document applies AT ALL — a row should never be
-- auto-created for an investor or a deal it doesn't apply to. One column,
-- two readings, both data-driven; no new catalogue field needed.
create or replace function app.doc_type_applies(
  p_gate_condition text, p_flags jsonb, p_investor_type text
) returns boolean
  language sql immutable
  set search_path = ''
  as $$
    select case
      when p_gate_condition is null then true
      when p_gate_condition = 'geared' then coalesce((p_flags->>'geared')::boolean, false)
      when p_gate_condition = 'hedged' then coalesce((p_flags->>'hedged')::boolean, false)
      when p_gate_condition like 'jurisdiction:%' then
        p_flags->>'jurisdiction' = split_part(p_gate_condition, ':', 2)
      when p_gate_condition like 'investor_type:%' then
        p_investor_type = split_part(p_gate_condition, ':', 2)
      -- 'regulated_disclosure' is a platform-level setting with nowhere to
      -- read from yet (docs/24 catalogue note) — default to applicable
      -- rather than silently hiding a document type until that setting
      -- exists. Session 3 revisits once it does.
      else true
    end
  $$;

-- EXECUTE grants below, for this and the other plain (non-trigger) functions
-- in this file: all are called from WITHIN a SECURITY INVOKER trigger body,
-- so Postgres checks their EXECUTE privilege against whichever role is
-- actually executing — `authenticated` — not at CREATE TRIGGER time. See
-- the longer note in migration 0043, which hit this requirement first.
revoke execute on function app.doc_type_applies(text, jsonb, text) from public, anon;
grant execute on function app.doc_type_applies(text, jsonb, text) to authenticated;

create or replace function app.investor_status_rank(status text) returns int
  language sql immutable
  set search_path = ''
  as $$
    select case status
      when 'matched'       then 0
      when 'teaser_sent'    then 1
      when 'nda_signed'     then 2
      when 'pack_released'  then 3
      when 'ioi_received'   then 4
      when 'soft_circled'   then 5
      when 'committed'      then 6
      when 'completed'      then 7
      else -1 -- 'declined': unranked, deliberately — see docs/24 and the
               -- TypeScript evaluator's investorStatusAtLeast(), which treats
               -- a declined investor as never "at or later than" anything.
    end
  $$;

revoke execute on function app.investor_status_rank(text) from public, anon;
grant execute on function app.investor_status_rank(text) to authenticated;

create or replace function app.ensure_deal_documents_for_stage(
  p_opportunity_id uuid, p_up_to_stage smallint
) returns void
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    insert into public.deal_document (org_id, opportunity_id, doc_type_key, status)
    select o.org_id, o.opportunity_id, dt.key, 'not_started'
      from public.doc_type dt
      join public.opportunities o on o.opportunity_id = p_opportunity_id
     where dt.scope = 'deal' and dt.is_active and dt.stage <= p_up_to_stage
       and app.doc_type_applies(dt.gate_condition, o.flags, null)
    on conflict (
      opportunity_id, doc_type_key,
      coalesce(deal_investor_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(counterparty_id,  '00000000-0000-0000-0000-000000000000'::uuid)
    ) do nothing;
    -- Investor-scoped creation is no longer driven by document_stage — see
    -- app.ensure_deal_documents_for_investor(), driven by the investor's own
    -- status instead.
  end
  $fn$;

revoke execute on function app.ensure_deal_documents_for_stage(uuid, smallint) from public, anon;
grant execute on function app.ensure_deal_documents_for_stage(uuid, smallint) to authenticated;

create or replace function app.ensure_deal_documents_for_investor(p_deal_investor_id uuid) returns void
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    insert into public.deal_document (org_id, opportunity_id, deal_investor_id, doc_type_key, status)
    select di.org_id, di.opportunity_id, di.deal_investor_id, dt.key, 'not_started'
      from public.doc_type dt
      join public.deal_investor di on di.deal_investor_id = p_deal_investor_id
     where dt.scope = 'investor' and dt.is_active
       and dt.investor_status_trigger is not null
       and app.investor_status_rank(dt.investor_status_trigger) <= app.investor_status_rank(di.status)
       and app.doc_type_applies(dt.gate_condition, '{}'::jsonb, di.investor_type)
    on conflict (
      opportunity_id, doc_type_key,
      coalesce(deal_investor_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(counterparty_id,  '00000000-0000-0000-0000-000000000000'::uuid)
    ) do nothing;
  end
  $fn$;

revoke execute on function app.ensure_deal_documents_for_investor(uuid) from public, anon;
grant execute on function app.ensure_deal_documents_for_investor(uuid) to authenticated;

-- ---- Decline: mark still-open investor documents not_applicable -----------
create or replace function app.mark_declined_investor_docs_not_applicable() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if new.status = 'declined' and old.status is distinct from 'declined' then
      update public.deal_document
         set status = 'not_applicable'
       where deal_investor_id = new.deal_investor_id
         and status in ('not_started', 'requested', 'instructed', 'draft', 'in_review');
    end if;
    return new;
  end
  $fn$;

-- ---- Hooks ------------------------------------------------------------------
create or replace function app.trg_opportunities_ensure_deal_documents() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'INSERT' then
      perform app.ensure_deal_documents_for_stage(new.opportunity_id, new.document_stage);
    elsif new.document_stage is distinct from old.document_stage then
      perform app.ensure_deal_documents_for_stage(new.opportunity_id, new.document_stage);
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_opportunities_ensure_deal_documents on opportunities;
create trigger trg_opportunities_ensure_deal_documents after insert or update on opportunities
  for each row execute function app.trg_opportunities_ensure_deal_documents();

create or replace function app.trg_deal_investor_ensure_deal_documents() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from new.status) then
      perform app.ensure_deal_documents_for_investor(new.deal_investor_id);
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_ensure_deal_documents on deal_investor;
create trigger trg_deal_investor_ensure_deal_documents after insert or update on deal_investor
  for each row execute function app.trg_deal_investor_ensure_deal_documents();

drop trigger if exists trg_deal_investor_decline on deal_investor;
create trigger trg_deal_investor_decline after update on deal_investor
  for each row execute function app.mark_declined_investor_docs_not_applicable();

-- ROLLBACK:
--   drop trigger if exists trg_deal_investor_decline on deal_investor;
--   drop function if exists app.mark_declined_investor_docs_not_applicable();
--   drop trigger if exists trg_deal_investor_ensure_deal_documents on deal_investor;
--   drop function if exists app.trg_deal_investor_ensure_deal_documents();
--   drop trigger if exists trg_opportunities_ensure_deal_documents on opportunities;
--   drop function if exists app.trg_opportunities_ensure_deal_documents();
--   drop function if exists app.ensure_deal_documents_for_investor(uuid);
--   drop function if exists app.ensure_deal_documents_for_stage(uuid, smallint);
--   drop function if exists app.investor_status_rank(text);
--   drop function if exists app.doc_type_applies(text, jsonb, text);
