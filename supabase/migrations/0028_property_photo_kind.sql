-- ============================================================================
-- 0028 - property_photos.kind: a building photograph, or a map
-- ----------------------------------------------------------------------------
-- The Asset Snapshot carries a map image as well as a building photo. A map goes
-- through exactly the same lifecycle (upload, internal -> diligence clearance,
-- delete), so it is a KIND of row in property_photos, not a parallel table.
--
-- THE RISK THIS HAS TO CLOSE. Two investor-facing SECURITY DEFINER functions from
-- 0020 read this table and know nothing about kinds: a map staff mark `diligence`
-- would otherwise appear in an investor's gallery and could become the teaser
-- photo. They are replaced here, each unchanged except for ONE added line,
-- `pp.kind = 'building'`. (app.investor_publication_headline_photo is built on the
-- gallery function and needs no change: one gate, not two.) An investor still sees
-- building photographs and nothing else; no investor path to a map exists.
-- `create or replace` keeps the function's existing grants; the revoke and grant
-- are repeated so this file states the posture on its own.
--
-- A map is never a headline: the building gallery's headline slot, the pipeline
-- card and the teaser all read headlines, and none of them should ever pick a map
-- up. Enforced by a CHECK, not by the application remembering.
--
-- Existing rows are all building photographs: the default says so.
-- ============================================================================
alter table property_photos
  add column if not exists kind text not null default 'building';

alter table property_photos drop constraint if exists property_photos_kind_valid;
alter table property_photos add constraint property_photos_kind_valid
  check (kind in ('building', 'map'));

alter table property_photos drop constraint if exists property_photos_map_not_headline;
alter table property_photos add constraint property_photos_map_not_headline
  check (kind = 'building' or not is_headline);

comment on column property_photos.kind is
  'building | map. A map is the same lifecycle as a photograph (internal until cleared) but is never a headline and never reaches an investor: the investor functions of 0020 filter kind = ''building'' (replaced in 0028).';

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
       and pp.kind = 'building'
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
       and pp.kind = 'building'
       and pp.visibility = 'diligence'
       and app.document_tier('diligence') <= app.document_tier(e.document_access_level)
     -- created_at and photo_id break ties so the order is the same on every call.
     order by pp.is_headline desc, pp.sort_order, pp.created_at, pp.photo_id
  $fn$;

revoke execute on function app.investor_publication_photos(uuid) from public, anon;
grant  execute on function app.investor_publication_photos(uuid) to authenticated;
