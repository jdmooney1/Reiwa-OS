// ============================================================================
// Reiwa Capital — Investment Score model
// ----------------------------------------------------------------------------
// Every deal is scored out of 100 across 11 weighted criteria. Each category is
// scored 1–10; its weighted contribution is weight × score / 10. Weights sum to
// 100, so the overall is directly out of 100. This module is the single source
// of truth for the criteria, weights, computation and recommendation bands.
// ============================================================================
import type { Recommendation } from "@/types/database";

export type ScoreCategoryKey =
  | "location_quality"
  | "liquidity_exit"
  | "income_security"
  | "reversionary_potential"
  | "asset_management_upside"
  | "capex_risk"
  | "planning_heritage_risk"
  | "tenant_covenant_risk"
  | "japanese_depreciation"
  | "fx_financing_resilience"
  | "strategic_fit";

export interface ScoreCategoryDef {
  key: ScoreCategoryKey;
  label: string;
  weight: number; // out of 100
  short: string; // radar axis label
  guidance: string; // what a high score means
}

// Order and weights per Reiwa's investment criteria (weights sum to 100).
export const SCORE_CATEGORIES: ScoreCategoryDef[] = [
  { key: "location_quality", label: "Location Quality", weight: 15, short: "Location",
    guidance: "Strength and durability of the micro-location and submarket." },
  { key: "liquidity_exit", label: "Liquidity & Exit Depth", weight: 10, short: "Liquidity",
    guidance: "Depth of the buyer pool and ease of exit through cycles." },
  { key: "income_security", label: "Income Security", weight: 10, short: "Income",
    guidance: "Quality, durability and predictability of the income." },
  { key: "reversionary_potential", label: "Reversionary Potential", weight: 10, short: "Reversion",
    guidance: "Gap between passing rent and ERV, and capital reversion." },
  { key: "asset_management_upside", label: "Asset Management Upside", weight: 10, short: "AM Upside",
    guidance: "Value creation available through active management." },
  { key: "capex_risk", label: "Capex Risk", weight: 10, short: "Capex",
    guidance: "Lower risk / better-defined capital programme scores higher." },
  { key: "planning_heritage_risk", label: "Planning & Heritage Risk", weight: 10, short: "Planning",
    guidance: "Fewer planning / heritage constraints scores higher." },
  { key: "tenant_covenant_risk", label: "Tenant Covenant Risk", weight: 5, short: "Covenant",
    guidance: "Stronger tenant covenants score higher." },
  { key: "japanese_depreciation", label: "Japanese Depreciation Benefit", weight: 10, short: "JP Depr.",
    guidance: "Tax depreciation benefit available to Japanese investors." },
  { key: "fx_financing_resilience", label: "FX & Financing Resilience", weight: 5, short: "FX / Fin.",
    guidance: "Resilience of returns to FX and financing stress." },
  { key: "strategic_fit", label: "Strategic Fit", weight: 5, short: "Fit",
    guidance: "Alignment with Reiwa's mandate and investor base." },
];

export const CATEGORY_BY_KEY: Record<ScoreCategoryKey, ScoreCategoryDef> =
  Object.fromEntries(SCORE_CATEGORIES.map((c) => [c.key, c])) as Record<ScoreCategoryKey, ScoreCategoryDef>;

export const TOTAL_WEIGHT = SCORE_CATEGORIES.reduce((s, c) => s + c.weight, 0); // 100

/** Weighted contribution of a single category: weight × score / 10. */
export function weightedContribution(score: number, weight: number): number {
  return (weight * score) / 10;
}

/** Overall score out of 100 from a partial map of category scores (1–10). */
export function computeOverall(scores: Partial<Record<ScoreCategoryKey, number>>): number {
  const total = SCORE_CATEGORIES.reduce((sum, c) => {
    const s = scores[c.key];
    return s == null ? sum : sum + weightedContribution(s, c.weight);
  }, 0);
  return Math.round(total * 10) / 10; // one decimal
}

// Recommendation bands on the 0–100 overall.
export const RECOMMENDATION_BANDS: {
  min: number;
  rec: Recommendation;
  label: string;
}[] = [
  { min: 85, rec: "strong_proceed", label: "Strong Proceed" },
  { min: 70, rec: "proceed", label: "Proceed" },
  { min: 55, rec: "proceed_with_caution", label: "Proceed with Caution" },
  { min: 40, rec: "weak", label: "Weak" },
  { min: 0, rec: "reject", label: "Reject" },
];

export function recommendationFor(overall: number): Recommendation {
  return (RECOMMENDATION_BANDS.find((b) => overall >= b.min) ?? RECOMMENDATION_BANDS[RECOMMENDATION_BANDS.length - 1]).rec;
}
