// ============================================================================
// Value allocation and depreciation: the arithmetic, the reconciliation rule, and
// the form's behaviour. Pure; the same rule against a real database is in
// tests/value-allocation.test.ts.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALLOCATION_TOLERANCE, ALLOCATION_TOLERANCE_FLOOR, allocationProblem, allocationShares, annualDepreciation,
  checkAllocation, resolveAllocation,
} from "@/lib/underwriting/allocation";
import { initDerive, deriveReducer, isAutoFilled, reconcile, DERIVABLE } from "@/lib/underwriting/derive";
import { COMPARE_FIELDS } from "@/lib/underwriting/compare";

const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

describe("building share and annual depreciation", () => {
  it("building % is building / (land + building)", () => {
    const s = allocationShares(30_000_000, 34_000_000)!;
    expect(s.landPct).toBeCloseTo(46.875, 9);
    expect(s.buildingPct).toBeCloseTo(53.125, 9);
    expect(s.landPct + s.buildingPct).toBeCloseTo(100, 9);
  });

  it("is null without both halves, with a zero total, or with a negative half", () => {
    expect(allocationShares(null, 1)).toBeNull();
    expect(allocationShares(1, null)).toBeNull();
    expect(allocationShares(0, 0)).toBeNull();
    expect(allocationShares(-1, 5)).toBeNull();
    expect(allocationShares(0, 10)).toEqual({ landPct: 0, buildingPct: 100 });
  });

  it("annual depreciation is building / years, straight line", () => {
    expect(annualDepreciation(34_000_000, 40)).toBe(850_000);
    expect(annualDepreciation(1_000_000, 3)).toBeCloseTo(333_333.333, 3);
  });

  it("is null without a positive base or a whole-year life in range: nothing is guessed", () => {
    for (const [b, y] of [[null, 40], [0, 40], [-5, 40], [34e6, null], [34e6, 0], [34e6, 101], [34e6, 12.5], [34e6, NaN]] as const) {
      expect(annualDepreciation(b as number | null, y as number | null), `${b}/${y}`).toBeNull();
    }
  });
});

describe("the split must add up to the price", () => {
  it("is fine when it adds up exactly, or within 0.5%", () => {
    expect(checkAllocation(64_000_000, 30_000_000, 34_000_000)).toMatchObject({ gap: 0, ok: true });
    expect(checkAllocation(64_000_000, 30_000_000, 34_300_000)!.ok).toBe(true);        // +300k, tolerance 320k
    expect(checkAllocation(64_000_000, 29_700_000, 34_000_000)!.ok).toBe(true);
  });

  it("is refused beyond 0.5% of the price, on either side", () => {
    const over = checkAllocation(64_000_000, 30_000_000, 34_400_000)!;      // +400k > 320k
    const short = checkAllocation(64_000_000, 30_000_000, 33_000_000)!;
    expect(over).toMatchObject({ ok: false, gap: 400_000, tolerance: 320_000 });
    expect(short).toMatchObject({ ok: false, gap: -1_000_000 });
  });

  it("allows at least one currency unit, so a tiny price is not impossible to split", () => {
    expect(ALLOCATION_TOLERANCE_FLOOR).toBe(1);
    expect(checkAllocation(100, 40, 60.5)!.ok).toBe(true);
    expect(checkAllocation(100, 40, 62)!.ok).toBe(false);
  });

  it("claims nothing until both halves and the price are known", () => {
    expect(checkAllocation(64e6, null, 34e6)).toBeNull();
    expect(checkAllocation(64e6, 30e6, null)).toBeNull();
    expect(checkAllocation(null, 30e6, 34e6)).toBeNull();
  });

  it("allocationProblem says it in a sentence, and demands a price when both halves are given", () => {
    expect(allocationProblem(64e6, 30e6, 34e6, fmt)).toBeNull();
    expect(allocationProblem(64e6, 30e6, 33e6, fmt)).toBe(
      "Land value plus building value is £63,000,000, £1,000,000 short of the acquisition price of £64,000,000. The split must come within 0.5% of the price.");
    expect(allocationProblem(null, 30e6, 34e6, fmt)).toMatch(/Enter the acquisition price too/);
    expect(allocationProblem(null, 30e6, null, fmt)).toBeNull();
    expect(allocationProblem(64e6, 30e6, null, fmt)).toBeNull();
  });

  it("the TypeScript tolerance and the database CHECK are the same number", () => {
    const sql = readFileSync("supabase/migrations/0027_case_value_allocation.sql", "utf8").replace(/--.*$/gm, "");
    expect(sql).toContain(`greatest(${ALLOCATION_TOLERANCE_FLOOR}, ${ALLOCATION_TOLERANCE} * acquisition_price)`);
  });
});

describe("resolveAllocation: what a submission may carry", () => {
  const ok = { price: 64e6, land: 30e6, building: 34e6 };

  it("sets the method exactly when a life is given: there is only one method, nobody is asked for it", () => {
    expect(resolveAllocation({ ...ok, years: 40 }, fmt)).toEqual({ ok: true, depreciationYears: 40, depreciationMethod: "straight_line" });
    expect(resolveAllocation({ ...ok, years: null }, fmt)).toEqual({ ok: true, depreciationYears: null, depreciationMethod: null });
  });

  it("refuses a life that is not a whole number of years in 1-100", () => {
    for (const years of [0, 101, 12.5, -3]) {
      const r = resolveAllocation({ ...ok, years }, fmt);
      expect(r.ok, String(years)).toBe(false);
      expect(!r.ok && r.error).toMatch(/whole number of years from 1 to 100/);
    }
  });

  it("refuses a split that does not reconcile, with the gap", () => {
    const r = resolveAllocation({ price: 64e6, land: 30e6, building: 20e6, years: 40 }, fmt);
    expect(!r.ok && r.error).toContain("£14,000,000 short of the acquisition price of £64,000,000");
  });

  it("accepts a life with no split at all, and no split with no life", () => {
    expect(resolveAllocation({ price: 64e6, land: null, building: null, years: 40 }, fmt).ok).toBe(true);
    expect(resolveAllocation({ price: 64e6, land: null, building: null, years: null }, fmt).ok).toBe(true);
  });
});

describe("the underwriting form", () => {
  const BLANK: Record<string, string> = { acquisitionPrice: "", landValue: "", buildingValue: "", depreciationYears: "" };
  const start = (f: Record<string, string>) => initDerive({ ...BLANK, ...f });

  it("fills the building as the remainder of the price when only the land is entered, marked calculated", () => {
    const s = start({ acquisitionPrice: "64000000", landValue: "30000000" });
    expect(s.values.buildingValue).toBe("34000000");
    expect(isAutoFilled(s, "buildingValue")).toBe(true);
  });

  it("and the land when only the building is", () => {
    const s = start({ acquisitionPrice: "64000000", buildingValue: "34000000" });
    expect(s.values.landValue).toBe("30000000");
    expect(isAutoFilled(s, "landValue")).toBe(true);
  });

  it("never overwrites a half the person entered, and fills nothing without a price", () => {
    const both = start({ acquisitionPrice: "64000000", landValue: "30000000", buildingValue: "33000000" });
    expect(both.values.buildingValue).toBe("33000000");
    expect(isAutoFilled(both, "buildingValue")).toBe(false);
    expect(start({ landValue: "30000000" }).values.buildingValue).toBe("");
  });

  it("does not fill a negative remainder (a land value above the price)", () => {
    expect(start({ acquisitionPrice: "10000000", landValue: "12000000" }).values.buildingValue).toBe("");
  });

  it("typing in the auto-filled half makes it the person's; clearing it hands it back", () => {
    let s = start({ acquisitionPrice: "64000000", landValue: "30000000" });
    s = deriveReducer(s, { type: "edit", name: "buildingValue", raw: "33500000" });
    s = deriveReducer(s, { type: "blur", name: "buildingValue" });
    expect(s.values.buildingValue).toBe("33500000");
    expect(isAutoFilled(s, "buildingValue")).toBe(false);
    s = deriveReducer(s, { type: "edit", name: "buildingValue", raw: "" });
    s = deriveReducer(s, { type: "blur", name: "buildingValue" });
    expect(s.values.buildingValue).toBe("34000000");
  });

  it("warns, beside the fields, when the two halves entered do not add up, and says it will not save", () => {
    const w = reconcile({ acquisitionPrice: "64000000", landValue: "30000000", buildingValue: "20000000" }, "GBP");
    expect(w).toHaveLength(1);
    expect(w[0].group).toBe("allocation");
    expect(w[0].message).toContain("£14,000,000 short of the acquisition price £64,000,000");
    expect(w[0].message).toContain("before it can be saved");
    expect(reconcile({ acquisitionPrice: "64000000", landValue: "30000000", buildingValue: "34000000" }, "GBP")).toEqual([]);
    expect(reconcile({ acquisitionPrice: "64000000", landValue: "30000000" }, "GBP")).toEqual([]);
  });

  it("land and building are engine-fillable; the life is always the person's", () => {
    expect(DERIVABLE).toContain("landValue");
    expect(DERIVABLE).toContain("buildingValue");
    expect(DERIVABLE as readonly string[]).not.toContain("depreciationYears");
  });
});

describe("version comparison", () => {
  it("lists the allocation inputs so a change between versions is seen", () => {
    const keys = COMPARE_FIELDS.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["landValue", "buildingValue", "depreciationYears"]));
  });
});
