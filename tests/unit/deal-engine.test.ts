// ============================================================================
// The assessment engine against the deal it was generalised from.
// Pure arithmetic: no database, no model, no clock.
// ============================================================================
import { describe, it, expect } from "vitest";
import { irr, leaseRelativity, monthIndex, runEngine } from "@/lib/underwrite/engine";
import { analyse, applyTerms, compareTerms, HORIZONS, SCENARIOS } from "@/lib/underwrite/scenarios";
import { buildReport, fromStorable, toStorable, withTerms } from "@/lib/underwrite/report";
import { MH_LEASES, MH_PARAMS } from "./deal-engine.fixture";

describe("arithmetic", () => {
  it("irr solves a simple bond", () => {
    expect(irr([-100, 5, 5, 105])).toBeCloseTo(0.05, 6);
  });
  it("irr is NaN when the flows never change sign", () => {
    expect(irr([100, 5, 5])).toBeNaN();
  });
  it("monthIndex counts whole months", () => {
    expect(monthIndex("2027-01-01", "2028-07-01")).toBe(18);
    expect(monthIndex("2027-01-01", null)).toBeNull();
  });
  it("lease relativity is 1 at or above 80 years and falls below", () => {
    expect(leaseRelativity(85, 0.0625, 0.025)).toBe(1);
    expect(leaseRelativity(40, 0.0825, 0.025)).toBeLessThan(1);
    expect(leaseRelativity(40, 0.0825, 0.025)).toBeGreaterThan(leaseRelativity(20, 0.0825, 0.025));
  });
});

describe("Mutual House regression (standalone model: 8.0% sterling, 5.4% yen)", () => {
  const r = runEngine(MH_LEASES, MH_PARAMS);

  it("reproduces the first four years of rent exactly", () => {
    // The standalone model's annual gross rent, £M. Year 5 differs by design:
    // renewals now carry a letting fee and new leases a mid-term review.
    [4.074, 4.667, 5.205, 5.050].forEach((g, i) => expect(r.annual[i].gross / 1e6).toBeCloseTo(g, 2));
  });

  it("lands within half a point of the standalone returns", () => {
    expect(r.irrNet).toBeGreaterThan(0.075);
    expect(r.irrNet).toBeLessThan(0.086);
    expect(r.irrYenHedged).toBeGreaterThan(0.049);
    expect(r.irrYenHedged).toBeLessThan(0.06);
  });

  it("has the standalone model's interest cover and tax profile", () => {
    expect(r.icrMin).toBeCloseTo(1.85, 1);
    expect(r.annual[0].tax / 1e3).toBeCloseTo(341, -1);
  });

  it("hedging costs about the policy-rate gap", () => {
    expect(r.irrNet - r.irrYenHedged).toBeGreaterThan(0.02);
    expect(r.irrNet - r.irrYenHedged).toBeLessThan(0.03);
  });
});

describe("scenarios, horizons and reverse stress", () => {
  const a = analyse(MH_LEASES, MH_PARAMS);

  it("orders the scenarios: severe < downside < base < upside", () => {
    const by = Object.fromEntries(a.scenarios.map((s) => [s.key, s.irrNet]));
    expect(by.severe).toBeLessThan(by.downside);
    expect(by.downside).toBeLessThan(by.base);
    expect(by.base).toBeLessThan(by.upside);
    expect(a.scenarios.map((s) => s.key)).toEqual(SCENARIOS.map((s) => s.key));
  });

  it("covers every hold period and decays the lease past 80 years", () => {
    expect(a.horizons.map((h) => h.years)).toEqual([...HORIZONS]);
    const fifty = a.horizons.find((h) => h.years === 50)!;
    expect(fifty.unexpiredYears!).toBeLessThan(80);
    expect(fifty.exitYield).toBeGreaterThan(MH_PARAMS.exitYield);
  });

  it("finds the exit yield that wipes out the yen return (standalone: about 7.6%)", () => {
    expect(a.reverse.exitYieldYenZero).not.toBeNull();
    expect(a.reverse.exitYieldYenZero!).toBeGreaterThan(0.072);
    expect(a.reverse.exitYieldYenZero!).toBeLessThan(0.08);
  });

  it("prices lower for a higher target", () => {
    const prices = a.reverse.priceForYen.map((t) => t.price!);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThan(prices[i - 1]);
  });
});

describe("proposed terms are inputs the engine prices", () => {
  const terms = { priceFactor: 57.5 / 62.675, deferredShare: 2 / 62.675, extraGuaranteeMonths: 12, topUpMonths: 12, acqFeePct: 0.005 };

  it("improves every scenario and does not pay the deferred sum in the downside", () => {
    const c = compareTerms(MH_LEASES, MH_PARAMS, terms);
    for (const row of c.rows) expect(row.proposed.irrYenHedged).toBeGreaterThan(row.asking.irrYenHedged);
    const am = applyTerms(MH_LEASES, MH_PARAMS, terms);
    expect(runEngine(am.leases, am.params).deferredPaid).toBeGreaterThan(0);
    expect(c.headlinePrice).toBeCloseTo(59_500_000, -4);
  });

  it("does not touch the inputs it was given", () => {
    const before = JSON.stringify([MH_LEASES, MH_PARAMS]);
    applyTerms(MH_LEASES, MH_PARAMS, terms);
    expect(JSON.stringify([MH_LEASES, MH_PARAMS])).toBe(before);
  });
});

describe("a stored report", () => {
  it("survives JSON, with undefined IRRs stored as null", () => {
    const rep = withTerms(buildReport("GBP", "lease", MH_LEASES, MH_PARAMS, [], []), MH_LEASES, MH_PARAMS,
      { priceFactor: 1, deferredShare: 0, extraGuaranteeMonths: 0, topUpMonths: 0, acqFeePct: 0.01 });
    const back = fromStorable(toStorable(rep));
    expect(back).not.toBeNull();
    expect(back!.base.irrNet).toBeCloseTo(rep.base.irrNet, 10);
    expect(JSON.stringify(toStorable(rep))).not.toContain("NaN");
  });
});
