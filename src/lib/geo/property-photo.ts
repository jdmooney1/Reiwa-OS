// ============================================================================
// Serving one property's street photo: decide, fetch, hand back bytes.
// SERVER-ONLY. Pure orchestration over injected calls, so the rules are testable
// without Google or a database. The route is a thin wrapper around this.
// ----------------------------------------------------------------------------
// Nothing is stored. The picture is fetched from Google on every request and the
// bytes are returned to be streamed to the browser and forgotten.
// ============================================================================
import {
  describePano, fetchStreetViewImage, bearingDegrees,
  type PanoLookup, type ImageResult,
} from "@/lib/geo/street-view";
import { isPlottable } from "@/lib/geo/map-state";
import { isGeocodeExpired } from "@/lib/geo/freshness";

export interface PhotoSource {
  panoId: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string;
  geocodedAt: string | null;
}

export type PhotoResult =
  | { kind: "image"; bytes: Buffer; contentType: string }
  | { kind: "none" }
  | { kind: "error"; reason: string };

export interface PhotoDeps {
  describePano: (panoId: string) => Promise<PanoLookup>;
  fetchImage: (panoId: string, heading: number | null) => Promise<ImageResult>;
}

const LIVE: PhotoDeps = {
  describePano: (id) => describePano(id),
  fetchImage: (id, heading) => fetchStreetViewImage(id, heading),
};

/**
 * Aim the camera at the building when we can, and say nothing when we cannot.
 * The property's coordinates are Google-derived and expire after 30 days; an
 * expired or missing one gives no heading, so the picture is unaimed rather than
 * aimed by data we may no longer use.
 */
export function headingFor(src: PhotoSource, panoLocation: { lat: number; lng: number } | null, now: Date = new Date()): number | null {
  if (!panoLocation) return null;
  if (src.geocodeStatus !== "ok" || isGeocodeExpired(src.geocodedAt, now)) return null;
  if (!isPlottable(src.latitude, src.longitude)) return null;
  return bearingDegrees(panoLocation, { lat: src.latitude, lng: src.longitude! });
}

export async function loadPropertyPhoto(
  src: PhotoSource, deps: PhotoDeps = LIVE, now: Date = new Date(),
): Promise<PhotoResult> {
  if (!src.panoId) return { kind: "none" };

  const pano = await deps.describePano(src.panoId);
  // A panorama Google has retired is "no photo", not a fault.
  if (pano.kind === "no_imagery") return { kind: "none" };
  if (pano.kind === "failed") return { kind: "error", reason: pano.reason };

  const img = await deps.fetchImage(src.panoId, headingFor(src, pano.location, now));
  if (!img.ok) return { kind: "error", reason: img.reason };
  return { kind: "image", bytes: img.bytes, contentType: img.contentType };
}
