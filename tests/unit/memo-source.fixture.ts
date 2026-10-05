// Shared defaults for the pieces of a MemoSource the Asset Snapshot reads.
import type { MemoCase, MemoSource } from "@/lib/memo/compose";

export const NO_PROJECTION = { price: null, niyPct: null, passingRent: null, erv: null, capex: null };
export const NO_ASSET = { reference: null, addressLine: null, photoId: null };

export const SNAP_CASE: MemoCase = {
  caseId: "c1", version: 3, status: "approved", strategy: "Value-add",
  thesis: "Core-plus office.", businessPlanAssumptions: "Re-let floors 3-5.",
  acquisitionPrice: 64_000_000, acquisitionCosts: 600_000, capex: 1_000_000, totalCost: 65_600_000,
  equity: 35_600_000, grossRentalIncome: 2_048_000, noi: 1_900_800, erv: 2_200_000, occupancyPct: 93.1,
  debt: 30_000_000, ltvPct: 45.73, debtCostPct: 5.4,
  // Deliberately different from the price: the Snapshot's "Price Guidance" is the price, not the valuation.
  valuation: 70_000_000, exitValue: 78_000_000,
  entryYieldPct: 2.97, exitYieldPct: 4.5, holdPeriodYears: 5, targetIrr: 14.2, targetEquityMultiple: 1.9,
  landValue: null, buildingValue: null, depreciationYears: null, depreciationMethod: null,
};

/** A GBP deal with every field the Snapshot can show recorded. */
export function snapshotSource(over: Partial<MemoSource> = {}): MemoSource {
  return {
    opportunity: {
      name: "58 Queens Gate", market: "London", submarket: "South Kensington", city: "London", country: "United Kingdom",
      assetType: "office", strategy: "value_add", currency: "GBP", sizeSqft: 42_000, sizeSqm: null, summary: null,
      projected: NO_PROJECTION,
    },
    basis: { kind: "approved", case: SNAP_CASE },
    risks: [], ddItems: [], decision: null, score: null,
    fx: { currency: "GBP", rateToGbp: 1, asOf: "2026-08-27", source: "Base currency" },
    fxJpy: { currency: "JPY", rateToGbp: 0.0052, asOf: "2026-08-27", source: "ECB reference rate (auto)" },
    today: "2026-09-01",
    asset: { reference: "RC-LON-0012", addressLine: "58 Queens Gate, London, SW7 5JW", photoId: "11111111-1111-4111-8111-111111111111" },
    ...over,
  };
}
