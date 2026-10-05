// ============================================================================
// The Asset Snapshot's composition: real figures, unit conversions of real figures,
// and nothing else. Fixtures in, grid out; no database, no DOM.
// ============================================================================
import { describe, it, expect } from "vitest";
import { composeMemo, composeSnapshot, finaliseNotices, normaliseContent, sameContent, type MemoSource } from "@/lib/memo/compose";
import { NO_ASSET, NO_PROJECTION, SNAP_CASE, snapshotSource } from "./memo-source.fixture";

const snap = (over: Partial<MemoSource> = {}) => composeSnapshot(snapshotSource(over));
const eurDeal = (over: Partial<MemoSource> = {}) => snapshotSource({
  opportunity: { ...snapshotSource().opportunity, currency: "EUR" },
  fx: { currency: "EUR", rateToGbp: 0.871, asOf: "2026-08-27", source: "ECB reference rate (auto)" },
  ...over,
});

describe("a full record", () => {
  const s = snap();

  it("carries every figure from the basis case, as recorded", () => {
    expect(s).toMatchObject({
      ref: "RC-LON-0012", name: "58 Queens Gate", city: "London", country: "United Kingdom", submarket: "South Kensington",
      assetType: "Office", currency: "GBP",
      price: 64_000_000, niyPct: 2.97, passingRent: 2_048_000, erv: 2_200_000, occupancyPct: 93.1, capex: 1_000_000,
      addressLine: "58 Queens Gate, London, SW7 5JW", photoId: "11111111-1111-4111-8111-111111111111",
      preparedOn: "2026-09-01", basisLabel: "Reiwa underwriting v3 (approved)",
    });
  });

  it("Price Guidance is the acquisition price, never the valuation", () => {
    expect(s.price).toBe(64_000_000);
    expect(JSON.stringify(s)).not.toContain("70000000");
  });

  it("the yen equivalent is price x rate(GBP=1) / rate(JPY): 64m / 0.0052", () => {
    expect(s.priceJpy).toBeCloseTo(64_000_000 / 0.0052, 0);
    expect(s.fx).toMatchObject({ jpySource: "ECB reference rate (auto)", jpyAsOf: "2026-08-27", dealRateToGbp: null, staleNote: null });
    expect(s.fx!.jpyPerGbp).toBeCloseTo(1 / 0.0052, 6);
  });

  it("area comes from the record, with tsubo derived from square metres", () => {
    expect(s.area!.sqft).toBe(42_000);
    expect(s.area!.sqm).toBeCloseTo(42_000 * 0.09290304, 6);
    expect(s.area!.tsubo).toBeCloseTo(s.area!.sqm! / 3.30578, 9);
  });

  it("never states the exit yield as a reversionary yield, or any yield it was not given", () => {
    const json = JSON.stringify(s);
    expect(json).not.toContain("4.5");
    expect(s.gaps.map((g) => g.key)).toContain("rev_yield");
  });

  it("lists what the template has a place for and the record cannot fill", () => {
    expect(s.gaps.map((g) => g.key)).toEqual(
      expect.arrayContaining(["rev_yield", "wault", "value_allocation", "property_facts", "property_notes", "transport", "map"]));
    expect(s.gaps.map((g) => g.key)).not.toContain("photo");
    expect(s.gaps.map((g) => g.key)).not.toContain("address");
  });
});

describe("a deal in another currency", () => {
  it("goes through pounds: 20m EUR at 0.871 GBP, into yen at 0.0052", () => {
    const s = composeSnapshot(eurDeal());
    expect(s.currency).toBe("EUR");
    expect(s.priceJpy).toBeCloseTo(64_000_000 * 0.871 / 0.0052, 0);
    expect(s.fx).toMatchObject({ dealRateToGbp: 0.871, dealSource: "ECB reference rate (auto)", dealAsOf: "2026-08-27" });
  });

  it("a deal already in yen quotes no yen equivalent and no FX line", () => {
    const s = snap({ opportunity: { ...snapshotSource().opportunity, currency: "JPY" } });
    expect(s.priceJpy).toBeNull();
    expect(s.fx).toBeNull();
    expect(s.gaps.map((g) => g.key)).not.toContain("jpy");
  });

  it("omits the yen figure and the FX line, and says why, when a rate is missing", () => {
    const noJpy = snap({ fxJpy: null });
    expect(noJpy.priceJpy).toBeNull();
    expect(noJpy.fx).toBeNull();
    expect(noJpy.gaps.find((g) => g.key === "jpy")!.why).toMatch(/No JPY exchange rate/);

    const noEur = composeSnapshot(eurDeal({ fx: null }));
    expect(noEur.priceJpy).toBeNull();
    expect(noEur.gaps.find((g) => g.key === "jpy")!.why).toMatch(/No EUR exchange rate/);
  });
});

describe("the FX staleness flag", () => {
  it("flags a rate older than 30 days with its age, and the oldest rate used governs", () => {
    const s = composeSnapshot(eurDeal({
      today: "2026-10-05",
      fx: { currency: "EUR", rateToGbp: 0.871, asOf: "2026-08-20", source: "ECB reference rate (auto)" },
      fxJpy: { currency: "JPY", rateToGbp: 0.0052, asOf: "2026-10-01", source: "ECB reference rate (auto)" },
    }));
    expect(s.fx!.staleNote).toBe("This rate is 46 days old.");
  });

  it("does not flag a fresh rate, nor a GBP deal's own date (GBP is 1 by definition)", () => {
    expect(snap({ today: "2026-09-20" }).fx!.staleNote).toBeNull();
    expect(snap({ today: "2026-12-01", fxJpy: { currency: "JPY", rateToGbp: 0.0052, asOf: "2026-11-30", source: "x" } }).fx!.staleNote).toBeNull();
  });

  it("flags the JPY rate on its own when that is the old one", () => {
    expect(snap({ today: "2026-10-05" }).fx!.staleNote).toBe("This rate is 39 days old.");
  });
});

describe("a partial record", () => {
  it("with no underwriting, falls back to the opportunity's own projection, labelled as such, and invents nothing else", () => {
    const s = snap({
      basis: { kind: "none", case: null },
      opportunity: { ...snapshotSource().opportunity, sizeSqft: null, sizeSqm: 1000,
        projected: { price: 25_000_000, niyPct: 5, passingRent: 1_250_000, erv: null, capex: null } },
      asset: NO_ASSET,
    });
    expect(s).toMatchObject({ price: 25_000_000, niyPct: 5, passingRent: 1_250_000, erv: null, capex: null, occupancyPct: null,
      basisLabel: "Reiwa opportunity record", addressLine: null, photoId: null, ref: null });
    expect(s.area!.tsubo).toBeCloseTo(1000 / 3.30578, 9);
    expect(s.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["photo", "address"]));
  });

  it("a case wins over the projection: a figure never comes from two places", () => {
    const s = snap({ opportunity: { ...snapshotSource().opportunity, projected: { price: 1, niyPct: 1, passingRent: 1, erv: 1, capex: 1 } } });
    expect(s.price).toBe(64_000_000);
    expect(s.erv).toBe(2_200_000);
  });

  it("with nothing recorded at all, every figure is null and there is no source line", () => {
    const s = composeSnapshot(snapshotSource({
      basis: { kind: "none", case: null },
      opportunity: { ...snapshotSource().opportunity, sizeSqft: null, sizeSqm: null, projected: NO_PROJECTION },
      asset: NO_ASSET, fx: null, fxJpy: null,
    }));
    expect(s).toMatchObject({ price: null, priceJpy: null, niyPct: null, passingRent: null, erv: null, occupancyPct: null, capex: null,
      area: null, fx: null, basisLabel: null, addressLine: null, photoId: null });
  });

  it("a working (unapproved) underwriting says so in the source label", () => {
    const s = snap({ basis: { kind: "working", case: { ...SNAP_CASE, status: "current", version: 2 } } });
    expect(s.basisLabel).toBe("Reiwa underwriting v2 (working version, not yet approved)");
  });

  it("an unrecorded occupancy is null, not zero", () => {
    expect(snap({ basis: { kind: "approved", case: { ...SNAP_CASE, occupancyPct: null } } }).occupancyPct).toBeNull();
  });
});

describe("the format and the stored memo", () => {
  it("composeMemo carries the snapshot beside the sections, and the prose sections never see the property facts", () => {
    const m = composeMemo(snapshotSource());
    expect(m.snapshot!.addressLine).toBe("58 Queens Gate, London, SW7 5JW");
    expect(JSON.stringify(m.sections)).not.toContain("Queens Gate, London, SW7");
    expect(JSON.stringify(m.sections)).not.toContain("11111111-1111-4111");
  });

  it("survives a jsonb round trip, and a memo stored before the Snapshot existed reads as having none", () => {
    const m = composeMemo(snapshotSource());
    expect(normaliseContent(JSON.parse(JSON.stringify(m)))!.snapshot).toEqual(m.snapshot);
    const old = JSON.parse(JSON.stringify(m)); delete old.snapshot;
    expect(normaliseContent(old)!.snapshot).toBeUndefined();
  });

  it("the prepared-on date moving does not make a saved draft look stale, but a changed figure does", () => {
    const a = composeMemo(snapshotSource({ today: "2026-09-01" }));
    expect(sameContent(a, composeMemo(snapshotSource({ today: "2026-09-02" })))).toBe(true);
    expect(sameContent(a, composeMemo(snapshotSource({ basis: { kind: "approved", case: { ...SNAP_CASE, capex: 2_000_000 } } })))).toBe(false);
  });

  it("finalising warns that the Snapshot carries the address and a photograph, and only then", () => {
    const m = composeMemo(snapshotSource());
    expect(finaliseNotices(m, "snapshot")[0]).toMatch(/street address and a photograph/);
    expect(finaliseNotices(m, "snapshot")[0]).toMatch(/diligence tier/);
    expect(finaliseNotices(m, "teaser")).toEqual([]);
    expect(finaliseNotices(composeMemo(snapshotSource({ asset: NO_ASSET })), "snapshot")).toEqual([]);
    expect(finaliseNotices(composeMemo(snapshotSource({ asset: { ...NO_ASSET, photoId: "p" } })), "snapshot")[0]).toMatch(/a photograph\./);
  });
});
