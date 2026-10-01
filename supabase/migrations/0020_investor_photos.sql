-- ============================================================================
-- 0020 - Investor photos: a photograph, only for diligence-tier investors
-- ----------------------------------------------------------------------------
-- DECISION (JD): a photograph reaches an investor only when BOTH hold:
--   1. staff have explicitly marked that photo `diligence` (property_photos,
--      migration 0019; every photo starts `internal`, there is no `standard`);
--   2. THIS investor's entitlement to the publication is at the diligence tier.
-- Photos are never more exposed than the location pin (0018): same gate, same
-- comparison, same entitlement row. Nothing is visible until a human clears it.
--
-- THE PATTERN IS 0018's, EXACTLY.
--   property_photos sits on the internal side (publication_sources ->
--   opportunities -> properties -> property_photos), reachable by an investor
--   through no policy, so it needs the same cross-boundary bridge location used:
--   narrow SECURITY DEFINER SQL functions with an empty search_path, each
--   RE-CHECKING EVERYTHING itself (the caller's own org, a visible entitlement
--   to THIS publication, a published publication with an active version, the
--   tier) because authenticated holds EXECUTE and an investor can call them with
--   any id. The view's WHERE clause is not relied on.
--
-- THE GATE: app.document_tier('diligence') <= app.document_tier(e.document_access_level).
--   Documents:  tier(document level) <= tier(entitlement level).
--   Location:   tier('diligence')    <= tier(entitlement level).
--   Photos:     tier('diligence')    <= tier(entitlement level), AND the photo is 'diligence'.
--   One function, one comparison, no second gate to drift.
--
-- WHAT THEY RETURN
--   app.investor_photo(uuid)                   object_path, mime_type, publication_id - for the
--                                              delivery route to sign and to record the view
--                                              against the publication that granted it. The
--                                              path is never sent to a browser.
--   app.investor_publication_photos(uuid)      photo_id, is_headline, sort_order, caption
--                                              for the deal page's gallery.
--   app.investor_publication_headline_photo()  one photo_id for the teaser.
--   investor_feed.headline_photo_id            appended; NULL unless a cleared photo exists.
--
-- The teaser photo is whichever DILIGENCE-visible photo sorts first (the headline
-- if it happens to be cleared, otherwise the earliest cleared gallery photo), not
-- necessarily the one staff marked is_headline. A deal with photos but none
-- cleared shows no image: that is correct, not a bug.
--
-- Live, not frozen: unlike a published version, a photo is read at request time,
-- so clearing a photo to `internal` removes it from an already-published
-- publication immediately.
-- ============================================================================

-- ---- One photo, for delivery ------------------------------------------------
create or replace function app.investor_photo(p_photo_id uuid)
  returns table (object_path text, mime_type text, publication_id uuid)
  language sql stable security definer
  set search_path = ''
  as $fn$
    select pp.object_path, pp.mime_type, p.publication_id
      from public.property_photos pp
      join public.properties pr          on pr.property_id    = pp.property_id
      join public.opportunities o        on o.property_id     = pr.property_id
      join public.publication_sources s  on s.opportunity_id  = o.opportunity_id
      join public.investor_publications p on p.publication_id = s.publication_id
      join public.publication_entitlements e on e.publication_id = p.publication_id
     where pp.photo_id = p_photo_id
       and pp.visibility = 'diligence'
       and e.investor_org_id = app.current_investor_org_id()
       and e.is_visible
       and p.status = 'published'
       and p.active_version_id is not null
       and app.document_tier('diligence') <= app.document_tier(e.document_access_level)
     limit 1
  $fn$;

revoke execute on function app.investor_photo(uuid) from public, anon;
grant  execute on function app.investor_photo(uuid) to authenticated;

-- ---- The gallery for one publication ----------------------------------------
create or replace function app.investor_publication_photos(p_publication_id uuid)
  returns table (photo_id uuid, is_headline boolean, sort_order int, caption text)
  language sql stable security definer
  set search_path = ''
  as $fn$
    select pp.photo_id, pp.is_headline, pp.sort_order, pp.caption
      from public.publication_entitlements e
      join public.investor_publications p on p.publication_id = e.publication_id
      join public.publication_sources s   on s.publication_id = p.publication_id
      join public.opportunities o         on o.opportunity_id = s.opportunity_id
      join public.properties pr           on pr.property_id   = o.property_id
      join public.property_photos pp      on pp.property_id   = pr.property_id
     where e.publication_id = p_publication_id
       and e.investor_org_id = app.current_investor_org_id()
       and e.is_visible
       and p.status = 'published'
       and p.active_version_id is not null
       and pp.visibility = 'diligence'
       and app.document_tier('diligence') <= app.document_tier(e.document_access_level)
     -- created_at and photo_id break ties so the order is the same on every call.
     order by pp.is_headline desc, pp.sort_order, pp.created_at, pp.photo_id
  $fn$;

revoke execute on function app.investor_publication_photos(uuid) from public, anon;
grant  execute on function app.investor_publication_photos(uuid) to authenticated;

-- ---- The teaser photo -------------------------------------------------------
-- Built on the gallery function, so there is one gate and not two. WITH
-- ORDINALITY keeps the gallery's own order, ties included.
create or replace function app.investor_publication_headline_photo(p_publication_id uuid)
  returns table (photo_id uuid)
  language sql stable security definer
  set search_path = ''
  as $fn$
    select g.photo_id
      from app.investor_publication_photos(p_publication_id)
           with ordinality as g(photo_id, is_headline, sort_order, caption, n)
     order by g.n
     limit 1
  $fn$;

revoke execute on function app.investor_publication_headline_photo(uuid) from public, anon;
grant  execute on function app.investor_publication_headline_photo(uuid) to authenticated;

-- ---- The view, with ONE column appended -------------------------------------
-- Everything else is exactly 0018's definition, location columns included.
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
         loc.longitude,
         -- NULL unless a diligence-visible photo exists for this publication AND
         -- this investor's entitlement is at the diligence tier.
         photo.photo_id as headline_photo_id
    from publication_entitlements e
    join investor_publications p on p.publication_id = e.publication_id
    join publication_versions v on v.version_id = p.active_version_id
    left join lateral app.investor_publication_location(p.publication_id) loc on true
    left join lateral app.investor_publication_headline_photo(p.publication_id) photo on true
   where e.is_visible
     and p.status = 'published'
     and v.status = 'published';

revoke all on investor_feed from anon, public;
grant select on investor_feed to authenticated;

comment on function app.investor_photo(uuid) is
  'object_path and mime_type of ONE photograph, for the calling investor, or no row. Requires: the photo marked diligence, the caller''s own visible entitlement to a published publication of that property, and entitlement tier >= diligence (app.document_tier). SECURITY DEFINER; the path is for server-side signing and is never sent to a browser.';
comment on function app.investor_publication_photos(uuid) is
  'The diligence-visible photographs of the property behind a publication, for the calling investor, in display order, or no rows. Same gates as app.investor_photo. SECURITY DEFINER.';
comment on function app.investor_publication_headline_photo(uuid) is
  'The first of app.investor_publication_photos for the calling investor, or no row. One gate, not two.';
