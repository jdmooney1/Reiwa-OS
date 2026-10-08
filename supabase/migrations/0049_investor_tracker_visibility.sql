-- ============================================================================
-- 0049 — investor_organizations visibility for the deal team
-- ----------------------------------------------------------------------------
-- FOUND BY LIVE TESTING, not a planned change: 0005's RLS on
-- investor_organizations grants select only to (a) app.is_admin() and (b) an
-- investor reading their own org (app.current_investor_org_id()). The
-- Session 3 investor tracker (listDealInvestors, src/lib/data/
-- deal-investors.ts) joins deal_investor to investor_organizations so any
-- org_user/ic_member working the deal can see which investor is which — but
-- under the existing policy set that join returns zero rows for anyone who
-- isn't reiwa_admin, so every deal_investor row vanishes from the tracker for
-- the staff who actually need to read it.
--
-- This grants read access to exactly the investor_organizations rows a
-- deal_investor row already ties to an org the session belongs to — not a
-- blanket "staff can read every investor org" grant, and it adds to the
-- existing admin/self policies rather than replacing them.
-- ============================================================================

drop policy if exists investor_organizations_deal_team on investor_organizations;
create policy investor_organizations_deal_team on investor_organizations for select to authenticated
  using (exists (
    select 1 from deal_investor di
     where di.investor_org_id = investor_organizations.investor_org_id
       and app.has_org(di.org_id)
  ));

-- ROLLBACK:
--   drop policy if exists investor_organizations_deal_team on investor_organizations;
