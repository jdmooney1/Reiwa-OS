// ============================================================================
// How long Google-derived location data may be kept.
// ----------------------------------------------------------------------------
// Google's Maps Platform terms allow latitude/longitude from the Geocoding API
// to be stored indefinitely only when the cached copy is isolated to one end
// user. This system's data is shared across staff, so the limit that applies is
// the temporary-caching one: 30 days. After that the coordinates (and the
// formatted address, which is Google content too) must be refreshed or removed.
// A place ID, by contrast, may be kept indefinitely.
//
// `properties.geocoded_at` is the freshness marker. It is stamped whenever the
// geocoder is asked, so "older than 30 days" means "due to be asked again".
// Coordinates entered by hand have no geocoded_at and never expire: they are not
// Google's.
//
// Pure, so the rule is one place, tested, and shared by the script (which
// refreshes and purges) and the app (which refuses to plot an expired pin even
// if nobody has run the script).
// ============================================================================

export const GEOCODE_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant before which a geocode is expired. */
export function geocodeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - GEOCODE_TTL_DAYS * DAY_MS);
}

/** True when the geocode is older than the limit. No timestamp means not Google's, so never. */
export function isGeocodeExpired(
  geocodedAt: string | Date | null | undefined, now: Date = new Date(),
): boolean {
  if (!geocodedAt) return false;
  const at = geocodedAt instanceof Date ? geocodedAt : new Date(geocodedAt);
  if (Number.isNaN(at.getTime())) return true; // unreadable: do not assume fresh
  return at.getTime() < geocodeCutoff(now).getTime();
}
