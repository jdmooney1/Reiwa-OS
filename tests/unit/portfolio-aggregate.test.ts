// ============================================================================
// Portfolio aggregates: a missing number is not a loss, and a count is a count.
// No database - the aggregation is pure.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  portfolioAggregate, actualVsPlan,
} from "@/lib/asset-intelligence/metrics";
import { materialChanges } from "@/lib/asset-intelligence/ai";
import { isPastDue } from "@/lib/dd/progress";
import type { AssetFile, AssetMetrics } from "@/lib/asset-intelligence/types";

const NONE: AssetMetrics = {
  gross_rental_income: null, noi: null, operating_expenses: null, occupancy_pct: null, capex: null,
  valuation: null, yield_pct: null, debt: null, ltv_pct: null, cash_on_cash_pct: null,
  equity_multiple: null, irr_pct: null,
};
const RATES = { GBP: 1, EUR: 0.85, JPY: 0.0052 };

function asset(id: string, over: {
  currency?: "GBP" | "EUR" | "JPY"; acq?: number | null; equity?: number | null;
  valuation?: number | null; decisions?: number;
}): AssetFile {
  return {
    asset: {
      asset_id: id, org_id: "o", portfolio_id: null, source_opportunity_id: null, name: id,
      address: null, city: null, country: null, market: null, asset_type: "office", strategy: null,
      lifecycle_stage: "operating", currency: over.currency ?? "GBP",
      acquisition_date: null, acquisition_price: over.acq ?? null, equity_invested: over.equity ?? null,
      hold_thesis: null, is_demo: false,
    } as AssetFile["asset"],
    plans: [], periods: [],
    valuations: over.valuation != null ? [{
      valuation_id: id + "v", asset_id: id, valuation_date: "2026-06-30", valuer: null,
      valuation: over.valuation, valuation_type: "external", noi: null, yield_pct: null,
      erv: null, methodology: null, key_assumptions: null,
    }] : [],
    risks: [],
    decisions: Array.from({ length: over.decisions ?? 0 }, (_, i) => ({
      decision_id: `${id}-d${i}`, asset_id: id, title: "t", issue: null, background: null, options: null,
      financial_impact: null, recommendation: null, decision_maker: null, deadline: null,
      status: "required", final_decision: null, decision_date: null, rationale: null,
    })) as AssetFile["decisions"],
  } as AssetFile;
}

// debt comes from the latest closed period.
function withDebt(f: AssetFile, debt: number): AssetFile {
  return { ...f, periods: [{
    period_id: "p", asset_id: f.asset.asset_id, period_label: "Q2", period_end: "2026-06-30",
    status: "closed", ...NONE, debt,
  }] } as AssetFile;
}

describe("Decisions Required", () => {
  it("is a whole-number count however many currencies are involved", () => {
    // 3 decisions on a yen asset used to be multiplied by the 0.0052 FX rate.
    const agg = portfolioAggregate([
      asset("gbp", { decisions: 2 }), asset("jpy", { currency: "JPY", decisions: 3 }),
    ], RATES);
    expect(agg.decisionsRequired).toBe(5);
    expect(Number.isInteger(agg.decisionsRequired)).toBe(true);
  });
});

describe("ratios poisoned by missing valuations", () => {
  const valued = withDebt(asset("valued", { acq: 100, equity: 40, valuation: 120 }), 60);
  const unvalued = withDebt(asset("unvalued", { acq: 200, equity: 80 }), 150);

  it("LTV uses only assets that have a valuation", () => {
    const agg = portfolioAggregate([valued, unvalued], RATES);
    expect(agg.ltv).toBeCloseTo(50, 5); // 60 / 120, not 210 / 120 = 175%
    expect(agg.coverage.ltv).toBe(1);
  });

  it("value vs cost compares like with like", () => {
    const agg = portfolioAggregate([valued, unvalued], RATES);
    expect(agg.valuationVsCostPct).toBeCloseTo(20, 5); // 120 vs 100, not 120 vs 300
    expect(agg.coverage.valueVsCost).toBe(1);
  });

  it("is null, not a distress figure, when nothing is valued", () => {
    const agg = portfolioAggregate([unvalued], RATES);
    expect(agg.ltv).toBeNull();
    expect(agg.valuationVsCostPct).toBeNull();
  });

  it("does not drop the unvalued asset from counts or money totals", () => {
    const agg = portfolioAggregate([valued, unvalued], RATES);
    expect(agg.assetCount).toBe(2);
    expect(agg.totalAcquisition).toBe(300);
    expect(agg.debt).toBe(210);
  });
});

describe("actual vs plan", () => {
  const plan = (type: "underwriting" | "current_forecast", noi: number) => ({
    plan_id: type, asset_id: "a", plan_type: type, version: 1, as_of_date: "2025-01-01", label: null,
    ...NONE, noi,
  });
  const period = (noi: number) => ({
    period_id: "p", asset_id: "a", period_label: "Q2 2026", period_end: "2026-06-30",
    status: "closed", ...NONE, noi,
  });
  const file = (over: Partial<AssetFile>) => ({ ...asset("a", {}), ...over }) as AssetFile;

  it("compares the latest actual to the forecast, and says so", () => {
    const f = file({ plans: [plan("underwriting", 100), plan("current_forecast", 90)] as never, periods: [period(99)] as never });
    const r = actualVsPlan(f, "noi")!;
    expect(r.against).toBe("forecast");
    expect(r.v.abs).toBe(9);
  });

  it("falls back to underwriting when there is no forecast", () => {
    const f = file({ plans: [plan("underwriting", 100)] as never, periods: [period(110)] as never });
    expect(actualVsPlan(f, "noi")!.against).toBe("underwriting");
  });

  it("is null without an actual", () => {
    expect(actualVsPlan(file({ plans: [plan("underwriting", 100)] as never }), "noi")).toBeNull();
  });

  it("leads the summary with the measured result, not the forecast movement", () => {
    const f = file({
      plans: [plan("underwriting", 100), plan("current_forecast", 80)] as never, // forecast down 20%
      periods: [period(95)] as never,                                            // actual 18.75% ahead of forecast
    });
    const first = materialChanges(f)[0].text;
    expect(first).toMatch(/^Actual NOI is .* ahead of plan/);
  });
});

describe("isPastDue", () => {
  it("is strictly before the reference date", () => {
    expect(isPastDue("2026-09-15", "2026-09-29")).toBe(true);
    expect(isPastDue("2026-09-29", "2026-09-29")).toBe(false);
    expect(isPastDue("2026-12-01", "2026-09-29")).toBe(false);
    expect(isPastDue(null, "2026-09-29")).toBe(false);
  });
});
