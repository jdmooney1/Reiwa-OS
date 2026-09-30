// ============================================================================
// Geocoding: a wrong coordinate is worse than none.
// No network, no database: Google's answers are fixtures.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { buildQuery, interpretResponse, geocodeAddress, type GoogleGeocodeBody } from "@/lib/geo/geocode";

const result = (over: Record<string, unknown> = {}) => ({
  formatted_address: "24-26 Spring St, London W2 1JA, UK",
  geometry: { location: { lat: 51.5158, lng: -0.1755 }, location_type: "ROOFTOP" },
  address_components: [{ types: ["country", "political"], short_name: "GB", long_name: "United Kingdom" }],
  ...over,
});
const ok = (over?: Record<string, unknown>): GoogleGeocodeBody => ({ status: "OK", results: [result(over)] });

describe("buildQuery", () => {
  it("joins address, city and country into one free-text query", () => {
    expect(buildQuery({ address: "24-26 Spring Street", city: "London", country: "United Kingdom" }))
      .toBe("24-26 Spring Street, London, United Kingdom");
  });

  it("skips blanks and trims", () => {
    expect(buildQuery({ address: " 5 Pollen Street ", city: null, country: "" })).toBe("5 Pollen Street");
  });

  it("is null with no address: a name alone is not geocodable", () => {
    expect(buildQuery({ address: null, city: "London", country: "UK" })).toBeNull();
    expect(buildQuery({ address: "   ", city: "London", country: "UK" })).toBeNull();
  });
});

describe("interpretResponse", () => {
  it("grants ok to a confident rooftop result", () => {
    const r = interpretResponse(ok(), "GB");
    expect(r).toMatchObject({ status: "ok", latitude: 51.5158, longitude: -0.1755 });
    expect(r.formattedAddress).toContain("Spring St");
  });

  it("accepts an interpolated street number", () => {
    expect(interpretResponse(ok({ geometry: { location: { lat: 1, lng: 2 }, location_type: "RANGE_INTERPOLATED" } }), "GB").status).toBe("ok");
  });

  it.each(["GEOMETRIC_CENTER", "APPROXIMATE"])("refuses %s: the centre of an area is not a building", (t) => {
    const r = interpretResponse(ok({ geometry: { location: { lat: 1, lng: 2 }, location_type: t } }), "GB");
    expect(r).toMatchObject({ status: "no_match", latitude: null, longitude: null });
    expect(r.formattedAddress).not.toBeNull(); // kept for review
  });

  it("refuses a partial match", () => {
    const r = interpretResponse(ok({ partial_match: true }), "GB");
    expect(r).toMatchObject({ status: "no_match", latitude: null, longitude: null });
    expect(r.reason).toMatch(/partial/);
  });

  it("refuses a result in the wrong country", () => {
    const r = interpretResponse(ok({ address_components: [{ types: ["country"], short_name: "US", long_name: "United States" }] }), "GB");
    expect(r).toMatchObject({ status: "no_match", latitude: null });
    expect(r.reason).toMatch(/US.*GB/);
  });

  it("skips the country check when the property has no known country", () => {
    expect(interpretResponse(ok({ address_components: [{ types: ["country"], short_name: "US", long_name: "x" }] }), null).status).toBe("ok");
  });

  it("maps ZERO_RESULTS to no_match", () => {
    expect(interpretResponse({ status: "ZERO_RESULTS", results: [] })).toMatchObject({ status: "no_match", latitude: null });
  });

  it("treats OK with no location as no_match, never a coordinate", () => {
    expect(interpretResponse({ status: "OK", results: [{ formatted_address: "x" }] }).status).toBe("no_match");
    expect(interpretResponse({ status: "OK", results: [] }).status).toBe("no_match");
  });

  it("maps an errored attempt to failed, with null coordinates", () => {
    const r = interpretResponse({ status: "UNKNOWN_ERROR" });
    expect(r).toMatchObject({ status: "failed", latitude: null, longitude: null });
    expect(r.fatal).toBeUndefined();
  });

  it.each(["REQUEST_DENIED", "OVER_DAILY_LIMIT"])("marks %s fatal so a run stops", (s) => {
    expect(interpretResponse({ status: s, error_message: "bad key" })).toMatchObject({ status: "failed", fatal: true });
  });
});

describe("geocodeAddress", () => {
  const input = { address: "24-26 Spring Street", city: "London", country: "United Kingdom", countryCode: "GB" };
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
  const noSleep = async () => {};

  it("asks Google once for a good answer", async () => {
    const f = vi.fn().mockResolvedValue(respond(ok()));
    const r = await geocodeAddress(input, { apiKey: "K", fetchImpl: f, sleep: noSleep });
    expect(r.status).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(f.mock.calls[0][0] as string);
    expect(url.searchParams.get("address")).toBe("24-26 Spring Street, London, United Kingdom");
  });

  it("backs off and retries OVER_QUERY_LIMIT, then succeeds", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(respond({ status: "OVER_QUERY_LIMIT" }))
      .mockResolvedValueOnce(respond({ status: "OVER_QUERY_LIMIT" }))
      .mockResolvedValueOnce(respond(ok()));
    const sleeps: number[] = [];
    const r = await geocodeAddress(input, { apiKey: "K", fetchImpl: f, sleep: async (ms) => { sleeps.push(ms); } });
    expect(r.status).toBe("ok");
    expect(sleeps).toEqual([500, 1000]);
  });

  it("gives up as failed, not as a guess, when the limit persists", async () => {
    const f = vi.fn().mockResolvedValue(respond({ status: "OVER_QUERY_LIMIT" }));
    const r = await geocodeAddress(input, { apiKey: "K", fetchImpl: f, sleep: noSleep, maxAttempts: 3 });
    expect(r).toMatchObject({ status: "failed", latitude: null, longitude: null });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry a definitive answer", async () => {
    const f = vi.fn().mockResolvedValue(respond({ status: "ZERO_RESULTS", results: [] }));
    expect((await geocodeAddress(input, { apiKey: "K", fetchImpl: f, sleep: noSleep })).status).toBe("no_match");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never puts the key in a returned reason", async () => {
    const f = vi.fn().mockRejectedValue(new Error("connect failed for https://x?key=SECRETKEY123"));
    const r = await geocodeAddress(input, { apiKey: "SECRETKEY123", fetchImpl: f, sleep: noSleep, maxAttempts: 1 });
    expect(r.status).toBe("failed");
    expect(r.reason).not.toContain("SECRETKEY123");
  });

  it("does not call Google for a property with no address", async () => {
    const f = vi.fn();
    const r = await geocodeAddress({ address: null, city: "London", country: "UK" }, { apiKey: "K", fetchImpl: f });
    expect(r.status).toBe("no_match");
    expect(f).not.toHaveBeenCalled();
  });

  it("throws on a missing key rather than failing every property quietly", async () => {
    const saved = process.env.GOOGLE_MAPS_SERVER_KEY;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    await expect(geocodeAddress(input, { fetchImpl: vi.fn() })).rejects.toThrow(/GOOGLE_MAPS_SERVER_KEY/);
    if (saved !== undefined) process.env.GOOGLE_MAPS_SERVER_KEY = saved;
  });
});
