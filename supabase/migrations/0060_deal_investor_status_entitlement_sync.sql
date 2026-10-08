-- ============================================================================
-- 0060 — deal_investor.status drives deal_document_entitlements automatically
-- ----------------------------------------------------------------------------
-- MISSED IN 4a, caught on review: the Session 4 plan named this explicitly
-- ("deal_investor status changes drive [deal_document_entitlements]
-- automatically") and the 4a build shipped the entitlements table (0054) and
-- the RLS that reads it (0056) without ever writing to it. Until now, every
-- entitlement row had to be created by hand.
--
-- Same cumulative idiom as app.ensure_deal_documents_for_investor (0047),
-- reusing its own app.investor_status_rank — not reimplemented: once an
-- investor's status reaches a threshold, EVERY lower-or-equal-ranked
-- document unlocks, whether that exact intermediate status was ever
-- literally set or jumped past.
--
--   rank(status) >= rank('nda_signed')    -> every Stage 1 investor-audience
--                                             document for this deal_investor
--                                             (deal- or investor-scoped)
--   rank(status) >= rank('ioi_received')  -> every Stage 2+ investor-audience
--                                             document, same scope rule
--
-- investor_nda, investor_teaser (exempt — never gated by entitlement, see
-- 0056) and underwriting_model (never reachable, see 0056) are explicitly
-- excluded here too — granting them an entitlement row would be harmless
-- (0056's RLS does not consult this table for the first two, and refuses
-- the third regardless), but a correct sync should not write misleading
-- rows either.
--
-- ADDED BEYOND THE LITERAL SPEC, flagged for review: on 'declined', every
-- entitlement this investor holds is revoked (is_visible = false), never
-- deleted. Nothing in the Session 4 plan named this, but leaving a declined
-- investor's entitlements visible is a real exposure, not a hypothetical
-- one, and the table's own default-deny posture is otherwise meaningless
-- the moment "declined" stops functioning as "revoked".
--
-- SECURITY INVOKER (no SECURITY DEFINER): whoever can UPDATE deal_investor
-- already holds has_org()/can_write() on deal_document_entitlements in the
-- same organisation — same posture as 0039, 0046, 0058.
-- ============================================================================

create or replace function app.sync_deal_document_entitlements_from_status() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if new.status = 'declined' then
      update public.deal_document_entitlements
         set is_visible = false
       where deal_investor_id = new.deal_investor_id
         and is_visible;
      return new;
    end if;

    if app.investor_status_rank(new.status) >= app.investor_status_rank('nda_signed') then
      insert into public.deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible, granted_by)
      select dd.org_id, new.deal_investor_id, dd.deal_document_id, true, app.current_user_id()::uuid
        from public.deal_document dd
        join public.doc_type dt on dt.key = dd.doc_type_key
       where dd.opportunity_id = new.opportunity_id
         and (dd.deal_investor_id = new.deal_investor_id or dd.deal_investor_id is null)
         and dt.stage = 1
         and 'investor' = any(dt.audience)
         and dt.key not in ('investor_nda', 'investor_teaser', 'underwriting_model')
      on conflict (deal_investor_id, deal_document_id) do update set is_visible = true;
    end if;

    if app.investor_status_rank(new.status) >= app.investor_status_rank('ioi_received') then
      insert into public.deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible, granted_by)
      select dd.org_id, new.deal_investor_id, dd.deal_document_id, true, app.current_user_id()::uuid
        from public.deal_document dd
        join public.doc_type dt on dt.key = dd.doc_type_key
       where dd.opportunity_id = new.opportunity_id
         and (dd.deal_investor_id = new.deal_investor_id or dd.deal_investor_id is null)
         and dt.stage >= 2
         and 'investor' = any(dt.audience)
         and dt.key <> 'underwriting_model'
      on conflict (deal_investor_id, deal_document_id) do update set is_visible = true;
    end if;

    return new;
  end
  $fn$;

revoke execute on function app.sync_deal_document_entitlements_from_status() from public, anon;
grant execute on function app.sync_deal_document_entitlements_from_status() to authenticated;

drop trigger if exists trg_deal_investor_sync_entitlements on deal_investor;
create trigger trg_deal_investor_sync_entitlements after insert or update on deal_investor
  for each row execute function app.sync_deal_document_entitlements_from_status();

-- ROLLBACK:
--   drop trigger if exists trg_deal_investor_sync_entitlements on deal_investor;
--   drop function if exists app.sync_deal_document_entitlements_from_status();
