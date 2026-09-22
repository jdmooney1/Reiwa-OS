// Human labels and tone treatment for the shared domain enums.
// Kept UI-agnostic: components decide how to render a "tone".
import type {
  AssetType, Strategy, RiskStatus, RiskLevel, Recommendation,
} from "@/types/database";

/**
 * The interface's restricted colour vocabulary.
 *
 * `emphasis` is plum — the brand emphasis, not an accent hue. `positive`,
 * `caution` and `negative` are the desaturated functional signals, reserved for
 * verdicts, red flags and status. Nothing decorative is ever toned.
 */
export type Tone = "neutral" | "emphasis" | "positive" | "caution" | "negative" | "muted";

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  office: "Office",
  retail: "Retail",
  industrial: "Industrial",
  logistics: "Logistics",
  residential: "Residential",
  multifamily: "Multifamily",
  hotel: "Hotel",
  student_housing: "Student Housing",
  healthcare: "Healthcare",
  data_centre: "Data Centre",
  mixed_use: "Mixed Use",
  land: "Land",
  other: "Other",
};

export const STRATEGY_LABEL: Record<Strategy, string> = {
  core: "Core",
  core_plus: "Core+",
  value_add: "Value-Add",
  opportunistic: "Opportunistic",
  development: "Development",
};

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Open", mitigated: "Mitigated", accepted: "Accepted", closed: "Closed",
};

export const RISK_STATUS_TONE: Record<RiskStatus, Tone> = {
  open: "negative", mitigated: "positive", accepted: "caution", closed: "muted",
};

export const RISK_LEVEL_TONE: Record<RiskLevel, Tone> = {
  low: "positive", medium: "caution", high: "negative",
};

// ---- Legacy investment score (reference only) ------------------------------
// Retained alongside src/lib/scoring/model.ts. No screen renders these; the
// Five Tests verdict replaces them in Phase 1.

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  strong_proceed: "Strong Proceed",
  proceed: "Proceed",
  proceed_with_caution: "Proceed with Caution",
  weak: "Weak",
  reject: "Reject",
};

/** Tone band for an overall investment score (0-100). */
export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 70) return "positive";
  if (score >= 55) return "emphasis";
  if (score >= 40) return "caution";
  return "negative";
}

/** Tone band for a single category score (1-10). */
export function pillarTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 7.5) return "positive";
  if (score >= 5.5) return "emphasis";
  if (score >= 4) return "caution";
  return "negative";
}
