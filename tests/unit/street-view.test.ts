// ============================================================================
// Street View: find the panorama, aim at the building, serve live.
// No network, no database.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import {
  interpretMetadata, bearingDegrees, buildImageUrl, fetchStreetViewImage, lookupPano, describePano,
} from "@/lib/geo/street-view";
import { loadPropertyPhoto, headingFor, type PhotoSource, type PhotoDeps } from "@/lib/geo/property-photo";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("interpretMetadata", () => {
  it("returns the panorama id and where it was taken", () => {
    expect(interpretMetadata({ status: "OK", pano_id: "PANO123", location: { lat: 51.5, lng: -0.1 } }))
      .toEqual({ kind: "ok", panoId: "PANO123", location: { lat: 51.5, lng: -0.1 } });
  });

  it("treats ZERO_RESULTS and NOT_FOUND as no imagery, never as a placeholder to serve", () => {
    expect(interpretMetadata({ status: "ZERO_RESULTS" })).toEqual({ kind: "no_imagery" });
    expect(interpretMetadata({ status: "NOT_FOUND" })).toEqual({ kind: "no_imagery" });
  });

  it("does not accept OK without a panorama id", () => {
    expect(interpretMetadata({ status: "OK" }).kind).toBe("failed");
  });

  it("marks a denied key and a spent daily quota fatal", () => {
    expect(interpretMetadata({ status: "REQUEST_DENIED" })).toMatchObject({ kind: "failed", fatal: true });
    expect(interpretMetadata({ status: "OVER_DAILY_LIMIT" })).toMatchObject({ kind: "failed", fatal: true });
    expect(interpretMetadata({ status: "UNKNOWN_ERROR" })).toEqual({ kind: "failed", reason: "UNKNOWN_ERROR" });
  });
});

describe("bearingDegrees", () => {
  const p = { lat: 51.5, lng: -0.1 };
  it("points north, east, south and west", () => {
    expect(bearingDegrees(p, { lat: 51.6, lng: -0.1 })).toBeCloseTo(0, 3);
    expect(bearingDegrees(p, { lat: 51.5, lng: 0.0 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(p, { lat: 51.4, lng: -0.1 })).toBeCloseTo(180, 3);
    expect(bearingDegrees(p, { lat: 51.5, lng: -0.2 })).toBeCloseTo(270, 0);
  });
  it("stays within 0-360", () => {
    for (const to of [{ lat: 51.4, lng: -0.3 }, { lat: 51.6, lng: -0.3 }, { lat: 51.4, lng: 0.1 }]) {
      const b = bearingDegrees(p, to);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe("requests", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

  it("looks up outdoor panoramas near a point via the free metadata endpoint", async () => {
    const f = vi.fn().mockResolvedValue(ok({ status: "OK", pano_id: "P", location: { lat: 1, lng: 2 } }));
    await lookupPano({ lat: 51.5, lng: -0.1 }, { apiKey: "K", fetchImpl: f });
    const url = new URL(f.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/maps/api/streetview/metadata");
    expect(url.searchParams.get("location")).toBe("51.5,-0.1");
    expect(url.searchParams.get("source")).toBe("outdoor");
    expect(url.searchParams.get("radius")).toBe("50");
  });

  it("asks about a known panorama by id", async () => {
    const f = vi.fn().mockResolvedValue(ok({ status: "NOT_FOUND" }));
    expect(await describePano("OLDPANO", { apiKey: "K", fetchImpl: f })).toEqual({ kind: "no_imagery" });
    expect(new URL(f.mock.calls[0][0] as string).searchParams.get("pano")).toBe("OLDPANO");
  });

  it("builds a fixed-size image URL by panorama id, with heading only when known", () => {
    const withHeading = new URL(buildImageUrl("PANO", "K", 123.456));
    expect(withHeading.searchParams.get("pano")).toBe("PANO");
    expect(withHeading.searchParams.get("size")).toBe("640x400");
    expect(withHeading.searchParams.get("heading")).toBe("123.5");
    expect(new URL(buildImageUrl("PANO", "K", null)).searchParams.has("heading")).toBe(false);
  });

  it("returns image bytes, and refuses anything that is not an image", async () => {
    const img = { ok: true, status: 200, headers: new Headers({ "content-type": "image/jpeg" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    const r = await fetchStreetViewImage("P", 90, { apiKey: "K", fetchImpl: vi.fn().mockResolvedValue(img) });
    expect(r).toMatchObject({ ok: true, contentType: "image/jpeg" });

    const text = { ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    expect((await fetchStreetViewImage("P", 90, { apiKey: "K", fetchImpl: vi.fn().mockResolvedValue(text) })).ok).toBe(false);
    const bad = { ok: false, status: 403, headers: new Headers() } as Response;
    expect((await fetchStreetViewImage("P", 90, { apiKey: "K", fetchImpl: vi.fn().mockResolvedValue(bad) })).ok).toBe(false);
  });

  it("never puts the key in a returned reason", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom https://x/streetview?key=SECRETKEY9"));
    const r = await fetchStreetViewImage("P", null, { apiKey: "SECRETKEY9", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRETKEY9");
  });

  it("throws on a missing key", async () => {
    const saved = process.env.GOOGLE_MAPS_SERVER_KEY; delete process.env.GOOGLE_MAPS_SERVER_KEY;
    await expect(fetchStreetViewImage("P", null, { fetchImpl: vi.fn() })).rejects.toThrow(/GOOGLE_MAPS_SERVER_KEY/);
    if (saved !== undefined) process.env.GOOGLE_MAPS_SERVER_KEY = saved;
  });
});

describe("loadPropertyPhoto", () => {
  const src = (over: Partial<PhotoSource> = {}): PhotoSource => ({
    panoId: "PANO", latitude: 51.5158, longitude: -0.1755, geocodeStatus: "ok", geocodedAt: daysAgo(3), ...over,
  });
  const jpeg = { ok: true as const, bytes: Buffer.from([1, 2]), contentType: "image/jpeg" };
  const deps = (over: Partial<PhotoDeps> = {}): PhotoDeps => ({
    describePano: vi.fn().mockResolvedValue({ kind: "ok", panoId: "PANO", location: { lat: 51.5150, lng: -0.1755 } }),
    fetchImage: vi.fn().mockResolvedValue(jpeg),
    ...over,
  });

  it("serves an image, aimed at the building", async () => {
    const d = deps();
    const r = await loadPropertyPhoto(src(), d, NOW);
    expect(r).toMatchObject({ kind: "image", contentType: "image/jpeg" });
    const heading = (d.fetchImage as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
    expect(heading).toBeCloseTo(0, 0); // building is due north of the panorama
  });

  it("has nothing to serve without a panorama id, and asks Google nothing", async () => {
    const d = deps();
    expect(await loadPropertyPhoto(src({ panoId: null }), d, NOW)).toEqual({ kind: "none" });
    expect(d.describePano).not.toHaveBeenCalled();
    expect(d.fetchImage).not.toHaveBeenCalled();
  });

  it("treats a retired panorama as no photo, not a fault", async () => {
    const d = deps({ describePano: vi.fn().mockResolvedValue({ kind: "no_imagery" }) });
    expect(await loadPropertyPhoto(src(), d, NOW)).toEqual({ kind: "none" });
    expect(d.fetchImage).not.toHaveBeenCalled();
  });

  it("reports a Google fault as an error, and does not fetch an image after one", async () => {
    const d = deps({ describePano: vi.fn().mockResolvedValue({ kind: "failed", reason: "OVER_QUERY_LIMIT" }) });
    expect(await loadPropertyPhoto(src(), d, NOW)).toEqual({ kind: "error", reason: "OVER_QUERY_LIMIT" });
    expect(d.fetchImage).not.toHaveBeenCalled();
  });

  it("reports a failed image fetch as an error", async () => {
    const d = deps({ fetchImage: vi.fn().mockResolvedValue({ ok: false, reason: "HTTP 500 from Street View" }) });
    expect(await loadPropertyPhoto(src(), d, NOW)).toEqual({ kind: "error", reason: "HTTP 500 from Street View" });
  });

  it("does not aim by coordinates older than 30 days: unaimed, but still served", async () => {
    const d = deps();
    const r = await loadPropertyPhoto(src({ geocodedAt: daysAgo(40) }), d, NOW);
    expect(r.kind).toBe("image");
    expect((d.fetchImage as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBeNull();
  });
});

describe("headingFor", () => {
  const pano = { lat: 51.5, lng: -0.1 };
  const base: PhotoSource = { panoId: "P", latitude: 51.6, longitude: -0.1, geocodeStatus: "ok", geocodedAt: daysAgo(1) };
  it("aims when the geocode is ok and fresh", () => expect(headingFor(base, pano, NOW)).toBeCloseTo(0, 3));
  it("does not aim without a panorama location", () => expect(headingFor(base, null, NOW)).toBeNull());
  it("does not aim by a geocode that was not ok, or is unusable", () => {
    expect(headingFor({ ...base, geocodeStatus: "no_match" }, pano, NOW)).toBeNull();
    expect(headingFor({ ...base, latitude: null }, pano, NOW)).toBeNull();
  });
});
