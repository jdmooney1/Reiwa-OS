// ============================================================================
// Geocoding - turn a broker's address into a coordinate, or say why not.
// SERVER-ONLY: it reads GOOGLE_MAPS_SERVER_KEY, which has no referrer
// restriction precisely because it never reaches a browser.
// ----------------------------------------------------------------------------
// A WRONG COORDINATE IS WORSE THAN NONE. A pin in the wrong street reads as a
// fact, and nobody re-checks a fact. So `ok` is granted only when the geocoder
// is confident, and everything short of that keeps null coordinates:
//
//   * partial_match       Google found SOMETHING near the query, not the query.
//   * location_type       only ROOFTOP and RANGE_INTERPOLATED name a building.
//                         GEOMETRIC_CENTER and APPROXIMATE are a street, a
//                         postcode or a district - the centre of a place, not
//                         the place - and are refused, however plausible.
//   * country             the result must be in the country the property is in.
//                         "Emerald Theater, London" is not Emerald Theater in
//                         another country, and a name-only address is exactly
//                         where a stray match happens.
//
// A refused result is `no_match`, and its formatted address is still returned
// so a person can see what Google thought it was and decide.
//
// `failed` is different: the attempt went wrong and a retry is the remedy.
// A SYSTEMIC failure (a denied key, a spent daily quota) is `fatal`, so the
// caller stops instead of stamping every property in the run as failed.
// ============================================================================

export type GeocodeStatus = "ok" | "no_match" | "failed";

export interface GeocodeInput {
  address: string | null;
  city: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2 when known; used to check the result is in the right country. */
  countryCode?: string | null;
}

export interface GeocodeResult {
  status: GeocodeStatus;
  latitude: number | null;
  longitude: number | null;
  /** What Google resolved the query to. Present for no_match too, for review. */
  formattedAddress: string | null;
  /** One line for the reconciliation report. Never contains the key. */
  reason: string;
  /** Systemic: retrying other rows would fail the same way. Stop the run. */
  fatal?: boolean;
}

/**
 * The single free-text query Google wants: address, city, country.
 * The postcode is not sent separately. Null when there is no address at all:
 * a property known only by name is not geocodable, and asking would invite a
 * match on a business of the same name somewhere else.
 */
export function buildQuery(input: Pick<GeocodeInput, "address" | "city" | "country">): string | null {
  const address = input.address?.trim();
  if (!address) return null;
  return [address, input.city?.trim(), input.country?.trim()].filter(Boolean).join(", ");
}

interface GoogleComponent { types: string[]; short_name: string; long_name: string }
interface GoogleResult {
  formatted_address?: string;
  partial_match?: boolean;
  geometry?: { location?: { lat: number; lng: number }; location_type?: string };
  address_components?: GoogleComponent[];
}
export interface GoogleGeocodeBody {
  status: string;
  error_message?: string;
  results?: GoogleResult[];
}

const BUILDING_PRECISION = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

/** Statuses worth another attempt after a pause. */
const RETRYABLE = new Set(["OVER_QUERY_LIMIT", "UNKNOWN_ERROR"]);
/** Statuses that mean every later request will fail the same way. */
const FATAL = new Set(["REQUEST_DENIED", "OVER_DAILY_LIMIT"]);

/** Google's answer -> our verdict. Pure, so the rules are testable without a network. */
export function interpretResponse(
  body: GoogleGeocodeBody, expectedCountryCode?: string | null,
): GeocodeResult {
  const none = { latitude: null, longitude: null, formattedAddress: null };

  if (body.status === "ZERO_RESULTS") {
    return { ...none, status: "no_match", reason: "Google found no result for this address" };
  }
  if (FATAL.has(body.status)) {
    return {
      ...none, status: "failed", fatal: true,
      reason: `${body.status}: ${body.error_message ?? "the key was refused or the daily quota is spent"}`,
    };
  }
  if (body.status !== "OK") {
    return {
      ...none, status: "failed",
      reason: `${body.status}${body.error_message ? `: ${body.error_message}` : ""}`,
    };
  }

  const first = body.results?.[0];
  const loc = first?.geometry?.location;
  if (!first || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return { ...none, status: "no_match", reason: "Google answered OK with no usable location" };
  }
  const formattedAddress = first.formatted_address ?? null;
  const refuse = (reason: string): GeocodeResult => ({
    status: "no_match", latitude: null, longitude: null, formattedAddress, reason,
  });

  if (first.partial_match) return refuse("partial match: Google resolved something near the address, not the address");

  const precision = first.geometry?.location_type ?? "UNKNOWN";
  if (!BUILDING_PRECISION.has(precision)) {
    return refuse(`${precision}: the centre of a street or area, not a building`);
  }

  const country = first.address_components?.find((c) => c.types.includes("country"))?.short_name;
  if (expectedCountryCode && country && country.toUpperCase() !== expectedCountryCode.toUpperCase()) {
    return refuse(`resolved to ${country}, expected ${expectedCountryCode.toUpperCase()}`);
  }

  return {
    status: "ok", latitude: loc.lat, longitude: loc.lng, formattedAddress,
    reason: `${precision}`,
  };
}

export interface GeocodeOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts per address, including the first. Default 4. */
  maxAttempts?: number;
}

const ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const BACKOFF_MS = [500, 1000, 2000];
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Strip a key out of anything about to be logged or stored. */
function redact(text: string, key: string): string {
  return key ? text.split(key).join("[key]") : text;
}

export async function geocodeAddress(
  input: GeocodeInput, opts: GeocodeOptions = {},
): Promise<GeocodeResult> {
  const query = buildQuery(input);
  if (!query) {
    return {
      status: "no_match", latitude: null, longitude: null, formattedAddress: null,
      reason: "no address to geocode (known by name only)",
    };
  }
  const key = opts.apiKey ?? process.env.GOOGLE_MAPS_SERVER_KEY ?? "";
  if (!key) throw new Error("GOOGLE_MAPS_SERVER_KEY is not set.");

  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const attempts = opts.maxAttempts ?? 4;
  const url = `${ENDPOINT}?${new URLSearchParams({ address: query, key }).toString()}`;

  let last: GeocodeResult = {
    status: "failed", latitude: null, longitude: null, formattedAddress: null, reason: "not attempted",
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
    try {
      const res = await doFetch(url);
      if (!res.ok) {
        last = { ...last, status: "failed", reason: `HTTP ${res.status} from the geocoder` };
        if (res.status >= 500 || res.status === 429) continue;
        return last;
      }
      const body = (await res.json()) as GoogleGeocodeBody;
      last = interpretResponse(body, input.countryCode);
      if (!RETRYABLE.has(body.status)) return last;
    } catch (e) {
      last = {
        status: "failed", latitude: null, longitude: null, formattedAddress: null,
        reason: `request failed: ${redact((e as Error).message, key)}`,
      };
    }
  }
  return last;
}
