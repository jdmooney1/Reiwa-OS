import { describe, it, expect } from "vitest";
import { SQM_PER_TSUBO, SQM_PER_SQFT, sqmToTsubo, sqftToSqm, sqmToSqft, areaFrom } from "@/lib/units";
import { convertViaGbp } from "@/lib/fx";
import { formatMoneyUnits } from "@/lib/format";

describe("tsubo", () => {
  it("is 400/121 square metres, to the precision the brief gives (3.30578)", () => {
    expect(SQM_PER_TSUBO).toBe(3.30578);
    expect(Math.abs(SQM_PER_TSUBO - 400 / 121)).toBeLessThan(1e-5);
  });

  it("converts square metres by dividing by 3.30578", () => {
    expect(sqmToTsubo(3.30578)).toBeCloseTo(1, 10);
    expect(sqmToTsubo(1000)).toBeCloseTo(302.5, 1);        // 1000 / 3.30578 = 302.50
    expect(sqmToTsubo(3_901.93)).toBeCloseTo(1180.3, 1);
    expect(sqmToTsubo(0)).toBe(0);
  });

  it("never invents an area: null, negative and non-numeric in, null out", () => {
    for (const bad of [null, undefined, -1, NaN, Infinity]) expect(sqmToTsubo(bad as number | null)).toBeNull();
  });
});

describe("sq ft <-> sq m", () => {
  it("uses the exact international-foot definition", () => {
    expect(SQM_PER_SQFT).toBe(0.09290304);
    expect(sqftToSqm(10_000)).toBeCloseTo(929.0304, 6);
    expect(sqmToSqft(929.0304)).toBeCloseTo(10_000, 6);
  });
});

describe("areaFrom", () => {
  it("derives every unit from sq m, and tsubo follows the metres", () => {
    const a = areaFrom(null, 1000)!;
    expect(a.sqm).toBe(1000);
    expect(a.tsubo).toBeCloseTo(302.5, 1);
    expect(a.sqft).toBeCloseTo(10_763.9, 1);
  });

  it("derives from sq ft alone", () => {
    const a = areaFrom(42_000, null)!;
    expect(a.sqft).toBe(42_000);
    expect(a.sqm).toBeCloseTo(3_901.93, 2);
    expect(a.tsubo).toBeCloseTo(1_180.3, 1);
  });

  it("keeps both recorded figures exactly as recorded when both exist (neither is overwritten)", () => {
    const a = areaFrom(42_000, 3_900)!;
    expect(a.sqft).toBe(42_000);
    expect(a.sqm).toBe(3_900);
    expect(a.tsubo).toBeCloseTo(3_900 / 3.30578, 6);
  });

  it("is null when the record has neither", () => {
    expect(areaFrom(null, null)).toBeNull();
    expect(areaFrom(undefined, NaN)).toBeNull();
  });
});

describe("convertViaGbp", () => {
  it("amount x rate(from) / rate(to): 64m GBP at JPY 0.0052 is about 12.3bn yen", () => {
    expect(convertViaGbp(64_000_000, 1, 0.0052)).toBeCloseTo(12_307_692_307.69, 0);
  });

  it("goes through GBP for a euro deal", () => {
    expect(convertViaGbp(20_000_000, 0.871, 0.005041)).toBeCloseTo(20_000_000 * 0.871 / 0.005041, 2);
  });

  it("is null when any input is missing or not a positive number: a rate is never assumed", () => {
    for (const [a, f, t] of [[null, 1, 1], [1, null, 1], [1, 1, null], [1, 0, 1], [1, 1, 0], [1, -1, 1], [NaN, 1, 1], [1, 1, NaN]] as const) {
      expect(convertViaGbp(a as number | null, f as number | null, t as number | null)).toBeNull();
    }
  });
});

describe("formatMoneyUnits", () => {
  it("writes millions and billions the way the template does", () => {
    expect(formatMoneyUnits(64_000_000, "GBP")).toBe("£64.0M");
    expect(formatMoneyUnits(2_048_000, "GBP")).toBe("£2.05M");
    expect(formatMoneyUnits(12_307_692_308, "JPY")).toBe("¥12.31B");
    expect(formatMoneyUnits(850_000, "EUR")).toBe("€850K");
    expect(formatMoneyUnits(420, "USD")).toBe("$420");
    expect(formatMoneyUnits(null, "GBP")).toBe("—");
  });
});
