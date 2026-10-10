// ============================================================================
// From a deal's records to engine inputs: tiers, precedence, provenance, and
// the rent roll and settings formats. Pure.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  parseOverridesText, parseRentRollCsv, rentRollToCsv, resolveInputs, defaultStart, type DealFacts,
} from "@/lib/underwrite/inputs";
import { runEngine } from "@/lib/underwrite/engine";

const TODAY = "2026-10-10";

function facts(over: Partial<DealFacts> = {}): DealFacts {
  return {
    name: "Test House", market: "London", assetType: "office", currency: "GBP", sizeSqft: 20000,
    opportunity: { targetPrice: 20_000_000, niy: 5.5, passingRent: null, erv: null, capexBudget: null },
    property: {
      tenure: "freehold", unexpiredTermYears: null, groundRentPa: null, groundRentNote: null,
      waultToExpiryYears: 4, waultToBreaksYears: null, rentReviewMechanism: null, epcRating: null,
    },
    case: null,
    fx: { yenPerUnit: 209.5, asOf: "2026-10-09", source: "ECB" },
    ...over,
  };
}

describe("tiers", () => {
  it("screens a deal with only a guide price and a quoted yield", () => {
    const r = resolveInputs(facts(), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tier).toBe("screen");
    expect(r.leases).toHaveLength(3);
    const income = r.lines.find((l) => l.key === "income")!;
    expect(income.source).toBe("derived");
    expect(r.gaps.join(" ")).toMatch(/No rent roll/);
    expect(Number.isFinite(runEngine(r.leases, r.params).irrNet)).toBe(true);
  });

  it("refuses, naming what is missing, when there is no price", () => {
    const r = resolveInputs(facts({ opportunity: { targetPrice: null, niy: null, passingRent: null, erv: null, capexBudget: null } }), TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.join(" ")).toMatch(/price/);
    expect(r.missing.join(" ")).toMatch(/income/);
  });

  it("models unit by unit when the case carries a rent roll", () => {
    const r = resolveInputs(facts({
      case: {
        caseId: "c1", version: 3, acquisitionPrice: 19_000_000, acquisitionCosts: null, acquisitionDate: "2027-01-01",
        capex: null, grossRentalIncome: null, noi: null, erv: null, occupancyPct: null, debt: null, ltvPct: null,
        debtCostPct: null, entryYieldPct: null, exitYieldPct: 5.75, holdPeriodYears: 7,
        assumptions: { rentRoll: [
          { unit: "G", tenant: "A", use: "retail", areaSqft: 3000, rentPa: 400000, expiry: "2031-01-01", breakDate: null, reviewDate: null, reviewBasis: "upward_only", ervPa: 420000, ervPsf: null, guaranteeUntil: null, reletCapexPsf: null, renewalProb: null },
          { unit: "1", tenant: "B", use: "office", areaSqft: 5000, rentPa: 500000, expiry: "2029-06-01", breakDate: null, reviewDate: null, reviewBasis: "upward_only", ervPa: null, ervPsf: 105, guaranteeUntil: null, reletCapexPsf: 20, renewalProb: null },
        ] },
      },
    }), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tier).toBe("lease");
    expect(r.leases).toHaveLength(2);
    expect(r.params.price).toBe(19_000_000);
    expect(r.params.holdYears).toBe(7);
    expect(r.lines.find((l) => l.key === "price")!.source).toBe("case");
    expect(r.lines.find((l) => l.key === "exit_yield")!.source).toBe("case");
  });
});

describe("precedence and provenance", () => {
  it("labels a market default as a default", () => {
    const r = resolveInputs(facts(), TODAY);
    if (!r.ok) throw new Error("expected a run");
    for (const k of ["rent_growth", "debt", "tax", "purchase_costs"] as const) {
      expect(r.lines.find((l) => l.key === k)!.source).toBe("default");
    }
  });

  it("reads a geared ground rent and a leasehold term from the property record", () => {
    const r = resolveInputs(facts({ property: { ...facts().property, tenure: "long_leasehold", unexpiredTermYears: 90.5, groundRentPa: 340000, groundRentNote: "12.5% of rents received" } }), TODAY);
    if (!r.ok) throw new Error("expected a run");
    expect(r.params.groundRent).toEqual({ kind: "geared", pct: 0.125, minimumPa: 340000 });
    expect(r.params.leaseholdExpiry).not.toBeNull();
    expect(r.lines.find((l) => l.key === "ground_rent")!.source).toBe("property");
  });

  it("uses a placeholder yen rate, and says so, when no rate is on file", () => {
    const r = resolveInputs(facts({ fx: null }), TODAY);
    if (!r.ok) throw new Error("expected a run");
    expect(r.lines.find((l) => l.key === "currency")!.source).toBe("default");
    expect(r.gaps.join(" ")).toMatch(/placeholder/);
  });

  it("applies case overrides over defaults", () => {
    const r = resolveInputs(facts({
      case: {
        caseId: "c1", version: 1, acquisitionPrice: null, acquisitionCosts: null, acquisitionDate: null, capex: null,
        grossRentalIncome: 1_200_000, noi: null, erv: null, occupancyPct: null, debt: null, ltvPct: null, debtCostPct: null,
        entryYieldPct: null, exitYieldPct: null, holdPeriodYears: null,
        assumptions: { model: { exitYieldPct: 6.5, purchaseCostsPct: 1.8, ltvPct: 40 } },
      },
    }), TODAY);
    if (!r.ok) throw new Error("expected a run");
    expect(r.params.exitYield).toBeCloseTo(0.065);
    expect(r.params.purchaseCostsPct).toBeCloseTo(0.018);
    expect(r.params.ltv).toBeCloseTo(0.4);
    expect(r.lines.find((l) => l.key === "debt")!.source).toBe("case");
  });

  it("starts three months out when the case gives no date", () => {
    expect(defaultStart("2026-10-10")).toBe("2027-01-01");
    expect(defaultStart("2026-11-30")).toBe("2027-02-01");
  });
});

describe("rent roll CSV", () => {
  const csv = [
    "unit,tenant,use,area_sqft,rent_pa,expiry,review_date,review_basis,erv_psf,renewal_pct",
    'G,"Shop, Ltd",retail,3000,"400,000",2031-01-01,2028-01-01,upward_only,,60',
    "1,,office,5000,0,,,,105,",
  ].join("\n");

  it("parses quoted cells, money with separators and percentages", () => {
    const p = parseRentRollCsv(csv);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.rows[0].tenant).toBe("Shop, Ltd");
    expect(p.rows[0].rentPa).toBe(400000);
    expect(p.rows[0].renewalProb).toBeCloseTo(0.6);
    expect(p.rows[1].ervPsf).toBe(105);
  });

  it("round-trips through the form", () => {
    const p = parseRentRollCsv(csv);
    if (!p.ok) throw new Error("expected rows");
    const again = parseRentRollCsv(rentRollToCsv(p.rows));
    expect(again).toEqual(p);
  });

  it("refuses the whole table, by row, when any row is wrong", () => {
    const bad = parseRentRollCsv("unit,use,area_sqft,rent_pa,expiry\nA,warehouse,100,10,2030-01-01\nB,office,100,10,31/01/2030");
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors).toHaveLength(2);
    expect(bad.errors[0]).toMatch(/Row 2/);
  });

  it("refuses an unknown column rather than ignoring it", () => {
    const bad = parseRentRollCsv("unit,use,area_sqft,rent_pa,landlord\nA,office,1,1,X");
    expect(bad.ok).toBe(false);
  });
});

describe("model settings text", () => {
  it("parses key = value lines and refuses unknown keys", () => {
    expect(parseOverridesText("exitYieldPct = 6.5\n# note\nltvPct: 40")).toEqual({ ok: true, overrides: { exitYieldPct: 6.5, ltvPct: 40 } });
    expect(parseOverridesText("exitYield = 6.5").ok).toBe(false);
    expect(parseOverridesText("ltvPct = 95").ok).toBe(false);
  });
});
