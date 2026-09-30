-- ============================================================================
-- 0017 - Street View: remember WHICH panorama, never the picture
-- ----------------------------------------------------------------------------
-- Google's terms forbid storing Street View imagery. What they do allow to be
-- kept indefinitely is the panorama's ID. So a property records the ID of the
-- panorama that shows it, and the picture is fetched from Google, live, each
-- time it is shown (src/app/api/property-photo/[propertyId]/route.ts). The image
-- bytes are never written anywhere: not this table, not Supabase Storage, not a
-- cache. The ID makes each fetch cheap (no search, no pick-a-nearest-pano
-- guesswork) and the framing consistent between views, because the same
-- panorama is always requested.
--
-- WHY TWO COLUMNS, AND WHAT IS DELIBERATELY NOT KEPT
--   street_view_pano_id      the panorama; NULL means none was found
--   street_view_checked_at   when Google was last asked. Without it a property
--                            with no coverage is indistinguishable from one
--                            never looked at, and would be asked about on every
--                            run. Our own timestamp, not Google content.
-- NOT kept: the panorama's own coordinates, its capture date, its copyright
-- string. They are Google content outside the ID exception, and the route reads
-- them from Google's free metadata endpoint when it needs them.
--
-- A stored ID can go stale (Google retires or replaces panoramas). The route
-- treats a panorama Google no longer knows as "no photo" rather than an error,
-- and db:resolve-street-view --recheck-none / --refresh look again.
--
-- NOTHING HERE REACHES INVESTORS. As with 0016, investor_feed projects from
-- publication_versions and joins neither properties nor opportunities. The route
-- that serves the picture refuses everyone who is not signed-in staff.
-- ============================================================================

alter table properties
  add column if not exists street_view_pano_id     text,
  add column if not exists street_view_checked_at  timestamptz;

comment on column properties.street_view_pano_id is
  'Google Street View panorama that shows this property. The ONLY Street View '
  'data kept: Google permits a panorama ID to be stored indefinitely and forbids '
  'storing the imagery. NULL = none found (see street_view_checked_at).';
comment on column properties.street_view_checked_at is
  'When Google was last asked for a panorama. NULL = never asked. With '
  'street_view_pano_id NULL it means "asked, and there is no coverage".';
