-- ============================================================================
-- 0047 — Auto-create deal_document rows on stage entry
-- ----------------------------------------------------------------------------
-- Per the original brief: "Auto-create deal-scoped deal_document rows when a
-- deal enters a stage (including all prior-stage rows if a deal is created
-- mid-way). Auto-create investor-scoped rows when a deal_investor record is
-- created or advances status."
--
-- INTERPRETATION, flagged for confirmation before Session 3: investor-scoped
-- doc_type rows are driven by the DEAL's document_stage (symmetric with the
-- deal-scoped case), not by the individual investor's own status funnel —
-- every investor-scoped doc_type in the seed catalogue is tagged Stage 1 or
-- 2, the same stage vocabulary as deal-scoped types, and nothing in the
-- catalogue ties a document's availability to a specific funnel status
-- (matched/teaser_sent/.../committed) rather than to the deal's stage. So:
-- rows are ensured (a) for every existing deal_investor whenever the deal's
-- document_stage advances, and (b) for a newly-created deal_investor, up to
-- the deal's current document_stage (the "mid-way" case). A literal reading
-- of "or advances status" — creating rows keyed to the INVESTOR's own status
-- transitions rather than the deal's stage — would need a different design;
-- raise it if that's what was intended and I'll add it in Session 3.
--
-- Implemented as triggers, not an application-layer function, for the same
-- reason every other invariant in this system is: a row existing is itself
-- part of what the gate gets evaluated against, so it should not depend on
-- every call site remembering to create it.
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

-- EXECUTE grants on this and the two ensure_* functions below: all three are
-- called as plain (non-trigger) functions from WITHIN a SECURITY INVOKER
-- trigger body, so Postgres checks their EXECUTE privilege against whichever
-- role is actually executing — `authenticated` — not at CREATE TRIGGER time.
-- See the longer note in migration 0043, which hit the same requirement
-- first.
revoke execute on function app.doc_type_applies(text, jsonb, text) from public, anon;
grant execute on function app.doc_type_applies(text, jsonb, text) to authenticated;

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

    -- Backfill investor-scoped rows for every investor already on this deal —
    -- a stage advance makes their Stage-N documents exist too.
    insert into public.deal_document (org_id, opportunity_id, deal_investor_id, doc_type_key, status)
    select di.org_id, di.opportunity_id, di.deal_investor_id, dt.key, 'not_started'
      from public.doc_type dt
      join public.deal_investor di on di.opportunity_id = p_opportunity_id
     where dt.scope = 'investor' and dt.is_active and dt.stage <= p_up_to_stage
       and app.doc_type_applies(dt.gate_condition, '{}'::jsonb, di.investor_type)
    on conflict (
      opportunity_id, doc_type_key,
      coalesce(deal_investor_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(counterparty_id,  '00000000-0000-0000-0000-000000000000'::uuid)
    ) do nothing;
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
      join public.opportunities o on o.opportunity_id = di.opportunity_id
     where dt.scope = 'investor' and dt.is_active and dt.stage <= o.document_stage
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
    perform app.ensure_deal_documents_for_investor(new.deal_investor_id);
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_ensure_deal_documents on deal_investor;
create trigger trg_deal_investor_ensure_deal_documents after insert on deal_investor
  for each row execute function app.trg_deal_investor_ensure_deal_documents();

-- ROLLBACK:
--   drop trigger if exists trg_deal_investor_ensure_deal_documents on deal_investor;
--   drop function if exists app.trg_deal_investor_ensure_deal_documents();
--   drop trigger if exists trg_opportunities_ensure_deal_documents on opportunities;
--   drop function if exists app.trg_opportunities_ensure_deal_documents();
--   drop function if exists app.ensure_deal_documents_for_investor(uuid);
--   drop function if exists app.ensure_deal_documents_for_stage(uuid, smallint);
--   drop function if exists app.doc_type_applies(text, jsonb, text);
