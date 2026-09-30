// ============================================================================
// Which investors may be shown where an opportunity is. Pure.
// ----------------------------------------------------------------------------
// The rule is enforced in the DATABASE first: investor_feed (migration 0018)
// returns latitude and longitude only when the investor's own entitlement to
// that publication is at the diligence tier, and only for a Google geocode that is
// confirmed and under 30 days old. Everything else arrives as NULL.
//
// This is the SECOND lock, in the application, so the rule does not rest on a
// single layer: a row is turned into a location only if it is diligence-tier
// AND carries usable coordinates. If the view were ever loosened by mistake, a
// standard-tier row would still come out of here as null.
//
// The tier is read from the row's own document_access_level, never from a
// parameter, a cookie or anything the client sends.
// ============================================================================

export interface PortalLocation { lat: number; lng: number }

/** The tier at which a location is shown. Documents use the same tier names. */
export const LOCATION_TIER = "diligence";

export function visibleLocation(row: {
  documentAccessLevel: string;
  latitude: number | null;
  longitude: number | null;
}): PortalLocation | null {
  if (row.documentAccessLevel !== LOCATION_TIER) return null;
  const { latitude: lat, longitude: lng } = row;
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
