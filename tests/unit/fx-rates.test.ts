// ============================================================================
// FX rates: staleness arithmetic and what an administrator may save.
// ----------------------------------------------------------------------------
// Pure, no database. The same rules against real RLS are in tests/fx-rates.test.ts.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  FX_STALE_AFTER_DAYS, fxAgeDays, fxStaleness, fxSetNote, oldestStaleness, isIsoDate, validateRateSubmission,
} from "@/lib/fx";

const TODAY = "2026-10-05";
const ok = (over: Record<string, unknown> = {}) => validateRateSubmission(
  { currency: "EUR", rate: "0.8512", source: "ECB euro reference rate", asOf: "2026-10-03", ...over }, TODAY);

describe("fxAgeDays / fxStaleness", () => {
  it("counts whole calendar days, across month ends and leap years", () => {
    expect(fxAgeDays("2026-08-27", "2026-10-05")).toBe(39);
    expect(fxAgeDays("2026-10-05", "2026-10-05")).toBe(0);
    expect(fxAgeDays("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("is stale strictly after 30 days, and says how old in the words the brief uses", () => {
    expect(FX_STALE_AFTER_DAYS).toBe(30);
    expect(fxStaleness("2026-09-05", TODAY)).toEqual({ ageDays: 30, stale: false, note: null });
    expect(fxStaleness("2026-09-04", TODAY)).toEqual({ ageDays: 31, stale: true, note: "This rate is 31 days old." });
  });

  it("never reports a negative age for a future-dated rate", () => {
    expect(fxAgeDays("2026-12-01", TODAY)).toBe(0);
  });

  it("returns null, not fresh, for a date it cannot read", () => {
    expect(fxStaleness("", TODAY)).toBeNull();
    expect(fxStaleness("27/08/2026", TODAY)).toBeNull();
    expect(fxStaleness("2026-02-31", TODAY)).toBeNull();
    expect(fxStaleness("2026-08-27", "tomorrow")).toBeNull();
  });

  it("the oldest rate governs a set, and an unreadable one is skipped not trusted", () => {
    const s = oldestStaleness(["2026-10-01", "2026-08-01", "garbage"], TODAY);
    expect(s?.ageDays).toBe(65);
    expect(fxSetNote(s)).toContain("65 days old");
    expect(fxSetNote(oldestStaleness(["2026-10-01"], TODAY))).toBeNull();
    expect(oldestStaleness([], TODAY)).toBeNull();
  });
});

describe("isIsoDate", () => {
  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2026-10-05")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-10-5")).toBe(false);
  });
});

describe("validateRateSubmission", () => {
  it("accepts a good submission and returns clean values", () => {
    expect(ok({ source: "  ECB euro reference rate  " })).toEqual({
      ok: true, value: { currency: "EUR", rate: 0.8512, source: "ECB euro reference rate", asOf: "2026-10-03" },
    });
  });

  it("REQUIRES a source: missing, blank and whitespace-only are all refused", () => {
    for (const source of [undefined, null, "", "   "]) {
      const r = ok({ source });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/a source is required/);
    }
  });

  it("refuses a placeholder as a source, including the seeded demo label", () => {
    for (const source of ["Demo static rates", "static", "TBC", "n/a", "unknown"]) {
      const r = ok({ source });
      expect(!r.ok && r.error).toMatch(/placeholder, not a source/);
    }
    expect(ok({ source: "Bloomberg close" }).ok).toBe(true);
  });

  it("refuses a currency the product does not keep", () => {
    expect(!ok({ currency: "CHF" }).ok).toBe(true);
    expect(ok({ currency: "jpy", rate: "0.0052" }).ok).toBe(true);
  });

  it("refuses rates that are not positive finite numbers within the column", () => {
    for (const rate of ["", "abc", "0", "-1", "NaN", "Infinity", "1000000", "0.1234567"]) expect(ok({ rate }).ok).toBe(false);
    expect(ok({ rate: 0.0052, currency: "JPY" }).ok).toBe(true);
  });

  it("GBP is 1 by definition", () => {
    expect(ok({ currency: "GBP", rate: "1.02" }).ok).toBe(false);
    expect(ok({ currency: "GBP", rate: "1" }).ok).toBe(true);
  });

  it("refuses a missing, malformed or future date", () => {
    for (const asOf of ["", "yesterday", "2026-02-31", "2026-10-06"]) expect(ok({ asOf }).ok).toBe(false);
    expect(ok({ asOf: TODAY }).ok).toBe(true);
  });

  it("refuses an over-long source", () => {
    expect(ok({ source: "x".repeat(201) }).ok).toBe(false);
  });
});
