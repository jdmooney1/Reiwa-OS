// ============================================================================
// Geocoded data expires after 30 days.
// ============================================================================
import { describe, it, expect } from "vitest";
import { GEOCODE_TTL_DAYS, geocodeCutoff, isGeocodeExpired } from "@/lib/geo/freshness";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("isGeocodeExpired", () => {
  it("uses a 30-day limit", () => expect(GEOCODE_TTL_DAYS).toBe(30));

  it("keeps a recent geocode", () => {
    expect(isGeocodeExpired(daysAgo(0), NOW)).toBe(false);
    expect(isGeocodeExpired(daysAgo(29), NOW)).toBe(false);
    expect(isGeocodeExpired(daysAgo(30), NOW)).toBe(false); // exactly 30 days is still inside the limit
  });

  it("expires anything older than 30 days", () => {
    expect(isGeocodeExpired(daysAgo(31), NOW)).toBe(true);
    expect(isGeocodeExpired(daysAgo(400), NOW)).toBe(true);
  });

  it("accepts ISO strings as Postgres returns them", () => {
    expect(isGeocodeExpired(daysAgo(40).toISOString(), NOW)).toBe(true);
    expect(isGeocodeExpired(daysAgo(2).toISOString(), NOW)).toBe(false);
  });

  it("never expires a coordinate with no geocoded_at: hand-entered data is not Google's", () => {
    expect(isGeocodeExpired(null, NOW)).toBe(false);
    expect(isGeocodeExpired(undefined, NOW)).toBe(false);
  });

  it("does not assume an unreadable timestamp is fresh", () => {
    expect(isGeocodeExpired("not a date", NOW)).toBe(true);
  });
});

describe("geocodeCutoff", () => {
  it("is exactly 30 days before now", () => {
    expect(geocodeCutoff(NOW).toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });
});
