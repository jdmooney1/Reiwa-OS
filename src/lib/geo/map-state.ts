// ============================================================================
// What the location panel should show for a property. Pure: no React, no
// network, so the decision is testable and the component only draws it.
// ============================================================================
import type { GeocodeStatus } from "@/lib/data/opportunity-types";

export type MapState =
  | { kind: "map"; lat: number; lng: number }
  | { kind: "unlocated"; message: string }
  | { kind: "unconfigured" };

/** A coordinate is plottable only if it is a finite point on the globe. */
export function isPlottable(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

const WHY: Record<GeocodeStatus, string> = {
  pending: "Not yet located. Run the geocoding script to place this property.",
  no_match: "The address could not be placed with confidence. A fuller address (street number, postcode) would help.",
  failed: "The last attempt to locate this property errored and can be retried.",
  ok: "Located, but the stored coordinates are unusable.",
};

/**
 * Pin only what was actually located. A property without confident coordinates
 * gets a sentence saying why, never a pin at a default or approximate spot: an
 * invented location reads as a fact.
 */
export function mapStateFor(
  p: { latitude: number | null; longitude: number | null; geocodeStatus: GeocodeStatus },
  browserKeyConfigured: boolean,
): MapState {
  if (isPlottable(p.latitude, p.longitude) && p.geocodeStatus === "ok") {
    // A coordinate we hold but the geocoder did not vouch for (entered by hand)
    // is not plotted here: this panel only shows what was verified.
    if (!browserKeyConfigured) return { kind: "unconfigured" };
    return { kind: "map", lat: p.latitude, lng: p.longitude! };
  }
  return { kind: "unlocated", message: WHY[p.geocodeStatus] };
}
