-- ============================================================================
-- 0056 — investor read access to deal_document / document_version, in RLS
-- ----------------------------------------------------------------------------
-- Session 4 visibility rules, enforced as database policy, not UI convention:
--
--   * underwriting_model is unreachable by the investor tenancy under ANY
--     condition — hard-coded here, not derived from doc_type.audience. Same
--     posture as docs/24 §6's memo-backing boundaries: an absolute rule like
--     this is exactly the kind of thing this codebase hard-codes rather than
--     configures, because a descriptive catalogue row next to it could drift
--     and nobody would notice.
--   * Every other investor-audience document is default-deny, gated by a
--     deal_document_entitlements row (0054) — EXCEPT investor_nda and
--     investor_teaser, which an investor may always read once matched to the
--     opportunity (missing rule, added on review): an investor must be able
--     to read the NDA to sign it, and the anonymised teaser is pre-NDA
--     marketing collateral. Neither is ever blocked by deal_investor.status.
--   * A document_version is additionally gated on deal_document.status
--     having reached Final/Signed (the governing version's own lifecycle),
--     and a non-governing JA version needs translation_status = 'reviewed'
--     on top of that — Session 4 decision C.
--   * Every one of the above is itself gated by app.deal_room_enabled()
--     (0055): off means none of this applies, full stop.
--
-- These add PERMISSIVE select policies alongside deal_document_select /
-- document_version_select (0039/0040), which already require app.has_org()
-- and so evaluate false for any investor session (empty org_ids, not admin).
-- Postgres ORs permissive policies together: this cannot widen staff access,
-- it only gives an investor session a path that was never there before.
-- ============================================================================

-- ---- Audience: investor-facing, minus the one absolute exclusion ----------
create or replace function app.investor_document_audience_ok(p_doc_type_key text) returns boolean
  language sql stable security definer
  set search_path = ''
  as $fn$
    select p_doc_type_key <> 'underwriting_model'
       and exists (
         select 1 from public.doc_type dt
          where dt.key = p_doc_type_key
            and 'investor' = any(dt.audience)
       )
  $fn$;

comment on function app.investor_document_audience_ok(text) is
  'underwriting_model is excluded unconditionally, by key, not by reading doc_type.audience for it — docs/24 Session 4: never reachable by the investor tenancy under any condition, a hard-coded rule rather than a configured one.';

-- ---- The deal_document-level answer ---------------------------------------
create or replace function app.investor_may_read_deal_document(p_deal_document_id uuid) returns boolean
  language sql stable security definer
  set search_path = ''
  as $fn$
    select app.deal_room_enabled()
       and app.is_investor()
       and exists (
         select 1 from public.deal_document dd
          where dd.deal_document_id = p_deal_document_id
            and app.investor_document_audience_ok(dd.doc_type_key)
            and (
              -- Exemption: investor_nda (own row only) and investor_teaser (deal-scoped,
              -- shared) are readable from the moment this investor is matched to the
              -- opportunity, independent of deal_investor.status and of any entitlement row.
              (
                dd.doc_type_key in ('investor_nda', 'investor_teaser')
                and exists (
                  select 1 from public.deal_investor di
                   where di.opportunity_id = dd.opportunity_id
                     and di.investor_org_id = app.current_investor_org_id()
                     and (dd.doc_type_key <> 'investor_nda' or di.deal_investor_id = dd.deal_investor_id)
                )
              )
              or
              -- Everything else: default-deny via deal_document_entitlements (0054).
              exists (
                select 1 from public.deal_document_entitlements e
                join public.deal_investor di on di.deal_investor_id = e.deal_investor_id
                where e.deal_document_id = p_deal_document_id
                  and e.is_visible
                  and di.investor_org_id = app.current_investor_org_id()
              )
            )
       )
  $fn$;

comment on function app.investor_may_read_deal_document(uuid) is
  'The deal_document-row-level answer for an investor session: flag on, audience ok, and (NDA/teaser exemption or a visible deal_document_entitlements row). docs/24 Session 4.';

revoke execute on function app.investor_document_audience_ok(text) from public, anon;
revoke execute on function app.investor_may_read_deal_document(uuid) from public, anon;
grant execute on function app.investor_document_audience_ok(text) to authenticated;
grant execute on function app.investor_may_read_deal_document(uuid) to authenticated;

drop policy if exists deal_document_investor_select on deal_document;
create policy deal_document_investor_select on deal_document for select to authenticated
  using (app.investor_may_read_deal_document(deal_document_id));

-- ---- The document_version-level answer ------------------------------------
-- Additional to the deal_document-level answer above: the document as a
-- whole must have reached Final/Signed, and a non-governing JA version
-- needs its own translation review on top of that (decision C).
create or replace function app.investor_may_read_document_version(p_version_id uuid) returns boolean
  language sql stable security definer
  set search_path = ''
  as $fn$
    select app.investor_may_read_deal_document(dv.deal_document_id)
       and dd.status in ('final', 'signed')
       and (dv.is_governing or (dv.language = 'JA' and dv.translation_status = 'reviewed'))
      from public.document_version dv
      join public.deal_document dd on dd.deal_document_id = dv.deal_document_id
     where dv.version_id = p_version_id
  $fn$;

comment on function app.investor_may_read_document_version(uuid) is
  'Decision C: the governing-language version must be Final/Signed before ANY version of the document is investor-visible; a non-governing JA version additionally needs translation_status = reviewed. docs/24 Session 4.';

revoke execute on function app.investor_may_read_document_version(uuid) from public, anon;
grant execute on function app.investor_may_read_document_version(uuid) to authenticated;

drop policy if exists document_version_investor_select on document_version;
create policy document_version_investor_select on document_version for select to authenticated
  using (app.investor_may_read_document_version(version_id));

-- ROLLBACK:
--   drop policy if exists document_version_investor_select on document_version;
--   drop function if exists app.investor_may_read_document_version(uuid);
--   drop policy if exists deal_document_investor_select on deal_document;
--   drop function if exists app.investor_may_read_deal_document(uuid);
--   drop function if exists app.investor_document_audience_ok(text);
