-- ============================================================================
-- 0018 - Investor location: a pin, only for diligence-tier investors
-- ----------------------------------------------------------------------------
-- DECISION (JD): the exact location of an opportunity is shown to an investor
-- only when THEIR ENTITLEMENT to that publication is at the 'diligence' tier.
-- A 'standard' investor sees exactly what they saw before: no pin, no
-- coordinates, no address. investor_feed gains two nullable columns, latitude
-- and longitude, that are non-null for diligence and NULL for everyone else.
--
-- WHY A FUNCTION, AND NOT A JOIN IN THE VIEW.
--   investor_feed reads only investor-readable tables, and deliberately joins
--   neither the provenance tables nor anything internal (0005). Location lives
--   on `properties`, which is reachable from a publication only through
--   publication_sources -> opportunities -> properties. The view is
--   security_invoker, so an investor's own RLS would apply to every one of those
--   tables and return nothing, by design; and it is not to join them regardless.
--   Storing the coordinates ON publication_versions instead would freeze Google-
--   derived data into an immutable published row for as long as it is live, well
--   past the 30-day limit on keeping it (0016, src/lib/geo/freshness.ts).
--   So the read is one narrow SECURITY DEFINER helper - the same pattern as
--   app.investor_can_read_document(), which already reaches across the boundary
--   on the investor's behalf and decides inside the function. It returns TWO
--   NUMBERS and nothing else: no address, no formatted address, no property or
--   opportunity id, nothing that identifies an internal record.
--
-- THE GATE IS app.document_tier(), USED THE WAY DOCUMENTS USE IT.
--   Documents: tier(document level) <= tier(entitlement level).
--   Location:  tier('diligence')     <= tier(entitlement level).
--   Same function, same comparison, same entitlement row; the location is simply
--   treated as a 'diligence'-level item. There is no second gate to drift.
--   'internal' cannot be an entitlement level (0005's CHECK), so it cannot reach
--   here either.
--
-- THE HELPER RE-CHECKS EVERYTHING; THE VIEW'S WHERE CLAUSE IS NOT RELIED ON.
--   authenticated holds EXECUTE on it, and an investor could call it directly
--   with any publication id. So inside the function: the caller's own
--   organisation (app.current_investor_org_id(), derived from auth.uid()), a
--   VISIBLE entitlement to THIS publication, a published publication with an
--   active version, and the tier. Anything else returns no row.
--
-- GOOGLE-DERIVED DATA STAYS INSIDE ITS 30 DAYS.
--   Only a geocode with status 'ok' and geocoded_at within 30 days is returned.
--   An expired one, a no_match, and coordinates entered by hand (never 'ok') all
--   return nothing. The 30 in this file must match GEOCODE_TTL_DAYS in
--   src/lib/geo/freshness.ts; tests/unit/investor-no-location.test.ts checks it.
--
-- Migration 0017 (Street View) is a separate branch; this one is numbered 0018 so
-- the two do not collide. The runner applies by filename, so order is unaffected.
-- ============================================================================

create or replace function app.investor_publication_location(p_publication_id uuid)
  returns table (latitude numeric, longitude numeric)
  language sql stable security definer
  set search_path = ''
  as $fn$
    select pr.latitude, pr.longitude
      from public.publication_entitlements e
      join public.investor_publications p on p.publication_id = e.publication_id
      join public.publication_sources s   on s.publication_id = p.publication_id
      join public.opportunities o         on o.opportunity_id = s.opportunity_id
      join public.properties pr           on pr.property_id   = o.property_id
     where e.publication_id = p_publication_id
       and e.investor_org_id = app.current_investor_org_id()
       and e.is_visible
       and p.status = 'published'
       and p.active_version_id is not null
       and app.document_tier('diligence') <= app.document_tier(e.document_access_level)
       and pr.geocode_status = 'ok'
       and pr.latitude is not null
       and pr.longitude is not null
       and pr.geocoded_at >= now() - interval '30 days'
     limit 1
  $fn$;

-- EXECUTE is enumerated, never blanket (0005/0007). A new function is granted to
-- PUBLIC by default, so revoke first, then grant to the one role that reaches it.
revoke execute on function app.investor_publication_location(uuid) from public, anon;
grant  execute on function app.investor_publication_location(uuid) to authenticated;

-- The view, with the two columns APPENDED so nothing that reads it moves.
-- Everything else is exactly 0005's definition.
create or replace view investor_feed with (security_invoker = true) as
  select e.investor_org_id,
         p.publication_id,
         v.version_id,
         v.version_number,
         e.placement,
         e.sort_order,
         e.investor_note,
         e.document_access_level,
         v.title, v.headline, v.overview,
         v.market, v.submarket, v.city, v.country,
         v.asset_type, v.strategy, v.currency,
         v.headline_price, v.target_niy, v.target_irr, v.target_equity_multiple,
         v.hold_period_years, v.size_sqft, v.size_sqm, v.highlights,
         v.published_at,
         -- NULL unless this investor's entitlement is at the diligence tier.
         loc.latitude,
         loc.longitude
    from publication_entitlements e
    join investor_publications p on p.publication_id = e.publication_id
    join publication_versions v on v.version_id = p.active_version_id
    left join lateral app.investor_publication_location(p.publication_id) loc on true
   where e.is_visible
     and p.status = 'published'
     and v.status = 'published';

revoke all on investor_feed from anon, public;
grant select on investor_feed to authenticated;

comment on function app.investor_publication_location(uuid) is
  'Latitude/longitude of the property behind a publication, for the calling '
  'investor, or no row. Requires: their own visible entitlement, a published '
  'publication, entitlement tier >= diligence (app.document_tier), and a Google '
  'geocode with status ok and geocoded_at within 30 days. SECURITY DEFINER; '
  'returns two numbers and no identifier.';
