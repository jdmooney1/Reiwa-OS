-- ============================================================================
-- 0058 — deal_investor.status: nda_signed and ioi_received require the fact
-- ----------------------------------------------------------------------------
-- Session 4 decision B: deal_document.status is authoritative. A deal_investor
-- row cannot move to:
--
--   'nda_signed'    unless its investor_nda deal_document has status = 'signed'
--   'ioi_received'  unless its investor_ioi  deal_document has status = 'final'
--
-- or a matching gate_override (0041) was recorded in the SAME transaction —
-- reason + admin/ic_member, I6 already enforces the latter via
-- gate_override's own RLS (app.can_override_gates()). Same same-transaction
-- correlation idiom as app.guard_post_close_document_version (0046) and
-- app.set_deal_investor_first_introduced (0038): go.at = now() is the
-- transaction timestamp, frozen for the whole transaction, so this is exact
-- correlation, not a time-window heuristic, and an override cannot be
-- logged ahead of time and spent later.
--
-- The override action is 'deal_investor_status_override', keyed by
-- gate_doc_type_key ('investor_nda' or 'investor_ioi') — a contract for
-- whoever builds the Session 4c override UI.
--
-- Deliberately NARROW: this gates only the two named target values. The
-- deal_investor.status funnel has no other sequencing enforcement anywhere
-- in this schema (any value may otherwise follow any other) — out of scope
-- for this decision, not silently fixed here.
--
-- SECURITY INVOKER (no SECURITY DEFINER): whoever can UPDATE deal_investor
-- already holds has_org() read access to deal_document and gate_override in
-- the same organisation — same posture as app.validate_deal_document_scope
-- (0039) and app.guard_post_close_document_version (0046).
-- ============================================================================

create or replace function app.guard_deal_investor_status_gates() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    doc_status   text;
    has_override boolean;
  begin
    if tg_op = 'UPDATE' and new.status is distinct from old.status then

      if new.status = 'nda_signed' then
        select dd.status into doc_status
          from public.deal_document dd
         where dd.deal_investor_id = new.deal_investor_id
           and dd.doc_type_key = 'investor_nda';

        if doc_status is distinct from 'signed' then
          select exists (
            select 1 from public.gate_override go
             where go.deal_investor_id = new.deal_investor_id
               and go.gate_doc_type_key = 'investor_nda'
               and go.action = 'deal_investor_status_override'
               and go.at = now()
          ) into has_override;
          if not has_override then
            raise exception
              'deal_investor % cannot move to nda_signed: investor_nda is not Signed (status %) and no matching deal_investor_status_override gate_override was recorded in this transaction',
              new.deal_investor_id, coalesce(doc_status, 'not_started');
          end if;
        end if;
      end if;

      if new.status = 'ioi_received' then
        select dd.status into doc_status
          from public.deal_document dd
         where dd.deal_investor_id = new.deal_investor_id
           and dd.doc_type_key = 'investor_ioi';

        if doc_status is distinct from 'final' then
          select exists (
            select 1 from public.gate_override go
             where go.deal_investor_id = new.deal_investor_id
               and go.gate_doc_type_key = 'investor_ioi'
               and go.action = 'deal_investor_status_override'
               and go.at = now()
          ) into has_override;
          if not has_override then
            raise exception
              'deal_investor % cannot move to ioi_received: investor_ioi is not Final (status %) and no matching deal_investor_status_override gate_override was recorded in this transaction',
              new.deal_investor_id, coalesce(doc_status, 'not_started');
          end if;
        end if;
      end if;

    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_status_gates on deal_investor;
create trigger trg_deal_investor_status_gates before update on deal_investor
  for each row execute function app.guard_deal_investor_status_gates();

-- ROLLBACK:
--   drop trigger if exists trg_deal_investor_status_gates on deal_investor;
--   drop function if exists app.guard_deal_investor_status_gates();
