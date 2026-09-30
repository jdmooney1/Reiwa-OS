// ============================================================================
// The location panel pins only what the geocoder vouched for.
// ============================================================================
import { describe, it, expect } from "vitest";
import { mapStateFor, isPlottable } from "@/lib/geo/map-state";

const located = { latitude: 51.5158, longitude: -0.1755, geocodeStatus: "ok" as const };

describe("mapStateFor", () => {
  it("draws a map for an ok property when the browser key is configured", () => {
    expect(mapStateFor(located, true)).toEqual({ kind: "map", lat: 51.5158, lng: -0.1755 });
  });

  it("says the map is unconfigured, rather than failing, when there is no browser key", () => {
    expect(mapStateFor(located, false)).toEqual({ kind: "unconfigured" });
  });

  it.each(["pending", "no_match", "failed"] as const)("shows a reason, not a pin, for %s", (status) => {
    const s = mapStateFor({ latitude: null, longitude: null, geocodeStatus: status }, true);
    expect(s.kind).toBe("unlocated");
    expect((s as { message: string }).message.length).toBeGreaterThan(10);
  });

  it("does not plot coordinates the geocoder did not vouch for", () => {
    expect(mapStateFor({ latitude: 51.5, longitude: -0.12, geocodeStatus: "pending" }, true).kind).toBe("unlocated");
  });

  it("does not plot an ok row with unusable coordinates", () => {
    expect(mapStateFor({ latitude: null, longitude: null, geocodeStatus: "ok" }, true).kind).toBe("unlocated");
    expect(mapStateFor({ latitude: 999, longitude: 0, geocodeStatus: "ok" }, true).kind).toBe("unlocated");
  });
});

describe("isPlottable", () => {
  it("accepts a real point and refuses the rest", () => {
    expect(isPlottable(51.5, -0.1)).toBe(true);
    expect(isPlottable(0, 0)).toBe(true);
    expect(isPlottable(null, 1)).toBe(false);
    expect(isPlottable(91, 0)).toBe(false);
    expect(isPlottable(0, 181)).toBe(false);
    expect(isPlottable(NaN, 0)).toBe(false);
  });
});
