-- ============================================================================
-- 0016 - Property geocoding: where a building is, and how sure we are
-- ----------------------------------------------------------------------------
-- `properties` has carried `latitude` and `longitude` (numeric(9,6)) since 0002
-- and nothing has ever written them. This migration does NOT add them again; it
-- adds what is missing around them - the record of how a coordinate was arrived
-- at - and leaves the two columns exactly as they are.
--
-- 1. THE BROKER'S ADDRESS AND GOOGLE'S ARE KEPT APART.
--    `address` is what a broker typed. `formatted_address` is what the geocoder
--    resolved it to. They are compared, never merged: when they disagree, that
--    is the signal a coordinate should not be trusted, and merging them would
--    destroy it. The same posture resolveProperty() takes with every source -
--    a populated column is never clobbered by a later one.
--
-- 2. A FAILED GEOCODE IS A LEGITIMATE STATE.
--    Missing stays missing, as in the pipeline loader: a property that could not
--    be placed keeps NULL coordinates and says why, rather than carrying a guess.
--      pending   never attempted (the default: every existing row starts here)
--      ok        placed, with coordinates the geocoder was confident about
--      no_match  the geocoder answered but not confidently: no result, an
--                approximate or partial one, or one in the wrong country
--      failed    the attempt itself went wrong (quota, network, upstream error)
--    `no_match` and `failed` are different because they call for different
--    action: a no_match needs a better address, a failed one only needs a retry.
--
-- 3. `ok` MEANS COORDINATES EXIST. Enforced, because the reverse is the failure
--    that matters: a row claiming to be located with nothing to plot. The other
--    direction is deliberately NOT enforced - a row may hold coordinates without
--    being `ok` (entered by hand, or from a source that is not the geocoder).
--
-- 4. GEOCODED DATA EXPIRES AFTER 30 DAYS.
--    Google's terms let coordinates from the Geocoding API be stored
--    indefinitely only when the copy is isolated to one end user. Properties are
--    shared across staff, so the temporary-caching limit applies: 30 days. The
--    formatted address is Google content too and follows the same limit.
--    `geocoded_at` is therefore not just an audit stamp but the FRESHNESS
--    MARKER: a row geocoded more than 30 days ago is due to be asked again,
--    exactly like a pending one, and whatever is not refreshed is removed rather
--    than kept (db:geocode-properties does both; src/lib/geo/freshness.ts holds
--    the rule; the app refuses to plot an expired pin even if nobody has run the
--    script). Coordinates entered by hand have no geocoded_at and never expire -
--    they are not Google's. Deliberately NOT enforced in the database: expiry is
--    a function of the clock, and a CHECK cannot depend on now().
--
-- 5. NOTHING HERE REACHES INVESTORS.
--    investor_feed (0005) projects from publication_versions, which carries no
--    address, latitude or longitude, and joins neither `properties` nor
--    `opportunities`. Adding columns here cannot widen what an investor sees.
--    Whether a location should ever be shown to one is a separate decision that
--    needs its own migration.
-- ============================================================================

alter table properties
  add column if not exists formatted_address text,
  add column if not exists geocode_status    text not null default 'pending',
  add column if not exists geocoded_at       timestamptz;

alter table properties drop constraint if exists properties_geocode_status_check;
alter table properties add constraint properties_geocode_status_check
  check (geocode_status in ('pending', 'ok', 'failed', 'no_match'));

alter table properties drop constraint if exists properties_geocode_ok_has_coordinates_check;
alter table properties add constraint properties_geocode_ok_has_coordinates_check
  check (geocode_status <> 'ok' or (latitude is not null and longitude is not null));

-- The geocoding script selects on this; most rows will be 'ok' once it has run.
create index if not exists idx_properties_geocode_status
  on properties(org_id, geocode_status);

comment on column properties.formatted_address is
  'What the geocoder resolved the address to. Kept apart from `address` (the '
  'broker''s text) so the two can be compared. Populated for no_match too, so a '
  'rejected result can be reviewed; the coordinates stay NULL in that case. '
  'Google content: expires with geocoded_at, 30 days.';
comment on column properties.geocode_status is
  'pending = never attempted; ok = placed with confidence; no_match = geocoder '
  'answered but not confidently (nothing, approximate, partial or wrong country); '
  'failed = the attempt errored and is worth retrying. Only `ok` implies '
  'latitude and longitude are set.';
comment on column properties.geocoded_at is
  'When the geocoder was last asked, whatever the answer. THE FRESHNESS MARKER: '
  'latitude, longitude and formatted_address derived from Google may be kept '
  'for 30 days from this instant, then must be refreshed or removed. NULL on '
  'a hand-entered coordinate, which never expires.';
