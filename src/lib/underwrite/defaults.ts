// ============================================================================
// Market defaults for the assessment engine. PURE.
// ----------------------------------------------------------------------------
// A default is what the engine uses when neither the investment case nor the
// property record says otherwise. Every one is shown on the Assessment tab with
// the word "default" beside it and its basis, and the assessment rates its
// confidence, so a default can never pass for evidence.
//
// Dated. These were set in October 2026 and are a starting point for screening,
// not a market view. Change a deal's inputs through its investment case
// (assumptions.model), not by editing this file.
// ============================================================================
import type { Use } from "@/lib/underwrite/engine";

export const DEFAULTS_AS_OF = "October 2026";

export type MarketKey = "london" | "amsterdam" | "other";

export function marketKey(market: string | null, currency: string): MarketKey {
  const m = (market ?? "").toLowerCase();
  if (m.includes("london") || (currency === "GBP" && !m)) return "london";
  if (m.includes("amsterdam") || m.includes("netherlands")) return "amsterdam";
  return currency === "GBP" ? "london" : currency === "EUR" ? "amsterdam" : "other";
}

export interface MarketDefaults {
  label: string;
  purchaseCostsPct: number;
  purchaseCostsBasis: string;
  saleCostsPct: number;
  taxRate: number;
  taxBasis: string;
  debtRate: number;
  debtBasis: string;
  ltv: number;
  /** Policy rate of the deal currency, the hedge proxy. */
  policyRate: number;
  policyBasis: string;
  voidCostPsf: number;
  lettingFeePct: number;
  ervGrowth: Record<Use, number>;
}

const GROWTH_UK: Record<Use, number> = { office: 0.03, retail: 0.02, residential: 0.025, industrial: 0.03, hotel: 0.02, other: 0.02 };
const GROWTH_NL: Record<Use, number> = { office: 0.025, retail: 0.015, residential: 0.025, industrial: 0.025, hotel: 0.02, other: 0.02 };

export const MARKETS: Record<MarketKey, MarketDefaults> = {
  london: {
    label: "London",
    purchaseCostsPct: 0.068, purchaseCostsBasis: "Asset purchase: SDLT plus fees (about 1.8% if the deal is a share purchase)",
    saleCostsPct: 0.01,
    taxRate: 0.25, taxBasis: "UK corporation tax on non-resident landlords and on gains on UK property",
    debtRate: 0.0575, debtBasis: "Bank Rate 3.75% plus an assumed margin; no term sheet",
    ltv: 0.5,
    policyRate: 0.0375, policyBasis: "Bank of England Bank Rate, September 2026",
    voidCostPsf: 20, lettingFeePct: 0.15, ervGrowth: GROWTH_UK,
  },
  amsterdam: {
    label: "Amsterdam",
    purchaseCostsPct: 0.115, purchaseCostsBasis: "Asset purchase: 10.4% transfer tax plus fees",
    saleCostsPct: 0.01,
    taxRate: 0.258, taxBasis: "Dutch corporate income tax, headline rate",
    debtRate: 0.045, debtBasis: "Euro swap plus an assumed margin; no term sheet",
    ltv: 0.5,
    policyRate: 0.02, policyBasis: "ECB deposit facility rate (check before relying on it)",
    voidCostPsf: 10, lettingFeePct: 0.15, ervGrowth: GROWTH_NL,
  },
  other: {
    label: "Other",
    purchaseCostsPct: 0.07, purchaseCostsBasis: "Generic assumption; no market-specific basis",
    saleCostsPct: 0.01,
    taxRate: 0.25, taxBasis: "Generic assumption; take local tax advice",
    debtRate: 0.055, debtBasis: "Generic assumption; no term sheet",
    ltv: 0.5,
    policyRate: 0.03, policyBasis: "Generic assumption",
    voidCostPsf: 10, lettingFeePct: 0.15, ervGrowth: GROWTH_UK,
  },
};

/** Bank of Japan policy rate, the yen side of the hedge proxy. */
export const YEN_POLICY_RATE = 0.0125;
export const YEN_POLICY_BASIS = "Bank of Japan policy rate, September 2026";

/** Letting assumptions by the dominant use of the building. */
export const LETTING: Record<Use, { voidMonths: number; rentFreeMonths: number; renewalProb: number; renewalRentFreeMonths: number; newLeaseYears: number }> = {
  office:      { voidMonths: 6, rentFreeMonths: 9, renewalProb: 0.5, renewalRentFreeMonths: 3, newLeaseYears: 10 },
  retail:      { voidMonths: 6, rentFreeMonths: 9, renewalProb: 0.6, renewalRentFreeMonths: 3, newLeaseYears: 10 },
  residential: { voidMonths: 1, rentFreeMonths: 0, renewalProb: 0.6, renewalRentFreeMonths: 0, newLeaseYears: 1 },
  industrial:  { voidMonths: 6, rentFreeMonths: 6, renewalProb: 0.6, renewalRentFreeMonths: 3, newLeaseYears: 10 },
  hotel:       { voidMonths: 0, rentFreeMonths: 0, renewalProb: 1,   renewalRentFreeMonths: 0, newLeaseYears: 25 },
  other:       { voidMonths: 6, rentFreeMonths: 6, renewalProb: 0.5, renewalRentFreeMonths: 3, newLeaseYears: 10 },
};

/** Reiwa's standard proposal, the same terms the memos show. */
export const REIWA_FEES = { acqPct: 0.01, amPctEquity: 0.005, promotePct: 0.15, hurdle: 0.08 };

export const LIFECYCLE = {
  sinkPct: 0.01, sinkFromYear: 6,
  refreshEveryYears: 10, refreshPsf: 40, refreshUse: ["office"] as Use[],
  majorFirstYear: 20, majorEveryYears: 25, majorPsf: 150,
};

export const OTHER_DEFAULTS = {
  holdYears: 5,
  nonRecoverablePct: 0.02,
  /** Fixed running costs (SPV, audit, insurance excess) as a share of price, with a floor. */
  fixedCostsShare: 0.0015,
  fixedCostsFloor: 40_000,
  costInflation: 0.03,
  shortLeasePremium: 0.005,
  debtTermYears: 5,
  arrangementFeePct: 0.01,
  hedgeRatio: 1,
  /** A WAULT the source did not give: assumed, and shown as assumed. */
  waultYears: 5,
};

/** asset_type to the engine's use classes. Unknown types map to "other". */
export function engineUseOf(assetType: string | null | undefined): Use {
  const a = (assetType ?? "").toLowerCase();
  if (a.includes("office")) return "office";
  if (a.includes("retail") || a.includes("shop")) return "retail";
  if (a.includes("resi") || a.includes("apartment") || a.includes("living") || a.includes("pbsa") || a.includes("student")) return "residential";
  if (a.includes("industrial") || a.includes("logistic") || a.includes("warehouse")) return "industrial";
  if (a.includes("hotel") || a.includes("hospitality")) return "hotel";
  if (a.includes("mixed")) return "office";
  return "other";
}
