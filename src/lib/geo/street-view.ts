// ============================================================================
// Street View: find a panorama, aim at the building, fetch the picture.
// SERVER-ONLY. Uses GOOGLE_MAPS_SERVER_KEY, which has no referrer restriction
// precisely because it never reaches a browser: an <img src> pointing at Google
// with this key in the query string would publish it in every page's source.
// ----------------------------------------------------------------------------
// WHAT MAY BE KEPT: the panorama ID, and nothing else. The image is fetched live
// on every request and returned to the caller as bytes to pass on; this module
// never writes it anywhere, and tests/unit/street-view-no-storage.test.ts fails
// if any Street View code starts to.
//
// The metadata endpoint is free and answers whether imagery exists BEFORE a
// billable image request is made. That is what stops Google's grey "Sorry, we
// have no imagery here" placeholder from ever being served as if it were a
// photograph of the building.
// ============================================================================

const METADATA = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMAGE = "https://maps.googleapis.com/maps/api/streetview";

export interface Point { lat: number; lng: number }

export type PanoLookup =
  | { kind: "ok"; panoId: string; location: Point | null }
  | { kind: "no_imagery" }
  | { kind: "failed"; reason: string; fatal?: boolean };

interface MetadataBody {
  status: string;
  error_message?: string;
  pano_id?: string;
  location?: { lat: number; lng: number };
}

const FATAL = new Set(["REQUEST_DENIED", "OVER_DAILY_LIMIT"]);

/** Google's metadata answer -> ours. Pure. */
export function interpretMetadata(body: MetadataBody): PanoLookup {
  if (body.status === "OK") {
    if (!body.pano_id) return { kind: "failed", reason: "metadata answered OK without a panorama id" };
    const loc = body.location;
    const location = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
    return { kind: "ok", panoId: body.pano_id, location };
  }
  // ZERO_RESULTS: nothing near the point. NOT_FOUND: a panorama id Google no
  // longer knows. Both mean there is no picture to show.
  if (body.status === "ZERO_RESULTS" || body.status === "NOT_FOUND") return { kind: "no_imagery" };
  return {
    kind: "failed",
    reason: `${body.status}${body.error_message ? `: ${body.error_message}` : ""}`,
    ...(FATAL.has(body.status) ? { fatal: true } : {}),
  };
}

/**
 * Initial compass bearing from one point to another, 0-360 (0 = north, 90 =
 * east). The camera is pointed along it, from the panorama toward the building:
 * without a heading Street View faces along the road, which is often not at the
 * building at all.
 */
export function bearingDegrees(from: Point, to: Point): number {
  const rad = Math.PI / 180;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad)
          - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export interface StreetViewOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

const keyOf = (opts: StreetViewOptions): string => {
  const key = opts.apiKey ?? process.env.GOOGLE_MAPS_SERVER_KEY ?? "";
  if (!key) throw new Error("GOOGLE_MAPS_SERVER_KEY is not set.");
  return key;
};
const redact = (text: string, key: string) => (key ? text.split(key).join("[key]") : text);

async function metadata(params: Record<string, string>, opts: StreetViewOptions): Promise<PanoLookup> {
  const key = keyOf(opts);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${METADATA}?${new URLSearchParams({ ...params, key }).toString()}`);
    if (!res.ok) return { kind: "failed", reason: `HTTP ${res.status} from Street View metadata` };
    return interpretMetadata((await res.json()) as MetadataBody);
  } catch (e) {
    return { kind: "failed", reason: `request failed: ${redact((e as Error).message, key)}` };
  }
}

/**
 * Find the outdoor panorama nearest a point (within 50 m). Free: metadata
 * requests are not billed. `source=outdoor` excludes user-contributed indoor and
 * photosphere imagery, which is not a view of the building.
 */
export function lookupPano(point: Point, opts: StreetViewOptions = {}): Promise<PanoLookup> {
  return metadata({ location: `${point.lat},${point.lng}`, radius: "50", source: "outdoor" }, opts);
}

/** Ask about a panorama we already know: where it was taken, or that it is gone. */
export function describePano(panoId: string, opts: StreetViewOptions = {}): Promise<PanoLookup> {
  return metadata({ pano: panoId }, opts);
}

export const IMAGE_SIZE = "640x400"; // the largest the free tier allows
export const DEFAULT_FOV = 90;
export const DEFAULT_PITCH = 10; // a little up: a frontage, not the pavement

/** The Google URL for one picture. Contains the server key: never send it to a client. */
export function buildImageUrl(
  panoId: string, key: string, heading?: number | null,
): string {
  const p = new URLSearchParams({
    size: IMAGE_SIZE, pano: panoId, fov: String(DEFAULT_FOV), pitch: String(DEFAULT_PITCH), key,
  });
  if (heading !== undefined && heading !== null && Number.isFinite(heading)) {
    p.set("heading", heading.toFixed(1));
  }
  return `${IMAGE}?${p.toString()}`;
}

export type ImageResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; reason: string };

/**
 * Fetch the picture from Google, live. The bytes go back to the caller to pass
 * straight on to the browser; nothing here keeps them. Anything that is not an
 * image is a failure, never something to relay: Google answers an error with
 * text, and text served as a photograph is worse than a broken one.
 */
export async function fetchStreetViewImage(
  panoId: string, heading?: number | null, opts: StreetViewOptions = {},
): Promise<ImageResult> {
  const key = keyOf(opts);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(buildImageUrl(panoId, key, heading));
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} from Street View` };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return { ok: false, reason: `Street View answered ${contentType || "no content type"}, not an image` };
    return { ok: true, bytes: Buffer.from(await res.arrayBuffer()), contentType };
  } catch (e) {
    return { ok: false, reason: `request failed: ${redact((e as Error).message, key)}` };
  }
}
