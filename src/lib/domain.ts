// Human labels, ordering and accent treatment for domain enums.
// Kept UI-agnostic: components decide how to render the "tone".
//
// The pipeline vocabulary is NOT here. It used to be: a PipelineStage union,
// a PIPELINE_STAGES order and a pipelineStageOf() mapping deal_stage/status
// onto board columns — a second, unreferenced stage model sitting alongside
// the opportunities one the product actually runs on (see OppStage in
// src/lib/data/opportunity-types.ts). Two vocabularies for one concept is how
// two screens end up disagreeing about what stage a deal is in.
import type {
  AssetType, Strategy, Recommendation,
  PriorityLevel, DdStatus, RiskStatus, RiskLevel, DdSection, DdJurisdiction,
} from "@/types/database";

export type Tone = "neutral" | "accent" | "positive" | "caution" | "negative" | "muted";

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

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  strong_proceed: "Strong Proceed",
  proceed: "Proceed",
  proceed_with_caution: "Proceed with Caution",
  weak: "Weak",
  reject: "Reject",
};

export const RECOMMENDATION_TONE: Record<Recommendation, Tone> = {
  strong_proceed: "positive",
  proceed: "positive",
  proceed_with_caution: "caution",
  weak: "muted",
  reject: "negative",
};

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const PRIORITY_TONE: Record<PriorityLevel, Tone> = {
  low: "muted", medium: "neutral", high: "caution", critical: "negative",
};

// ---- Due diligence framework -----------------------------------------------
export const DD_STATUS_ORDER: DdStatus[] = [
  "not_started", "requested", "in_progress", "received",
  "reviewed", "issue_identified", "resolved", "not_applicable",
];

export const DD_STATUS_LABEL: Record<DdStatus, string> = {
  not_started: "Not Started",
  requested: "Requested",
  in_progress: "In Progress",
  received: "Received",
  reviewed: "Reviewed",
  issue_identified: "Issue Identified",
  resolved: "Resolved",
  not_applicable: "Not Applicable",
};

export const DD_STATUS_TONE: Record<DdStatus, Tone> = {
  not_started: "muted",
  requested: "neutral",
  in_progress: "caution",
  received: "accent",
  reviewed: "positive",
  issue_identified: "negative",
  resolved: "positive",
  not_applicable: "muted",
};

// A workstream is "cleared" when reviewed or resolved; N/A is excluded from totals.
export function isDdCleared(status: DdStatus): boolean {
  return status === "reviewed" || status === "resolved";
}
export function isDdOpen(status: DdStatus): boolean {
  return !isDdCleared(status) && status !== "not_applicable";
}
export function isDdIssue(status: DdStatus): boolean {
  return status === "issue_identified";
}

export const JURISDICTION_LABEL: Record<DdJurisdiction, string> = {
  UK: "UK", Netherlands: "Netherlands", Japan: "Japan", "Cross-border": "Cross-Border",
};

export const JURISDICTION_TONE: Record<DdJurisdiction, Tone> = {
  UK: "neutral", Netherlands: "neutral", Japan: "accent", "Cross-border": "caution",
};

// The Reiwa DD framework sections, in memo order.
export const DD_SECTIONS: DdSection[] = [
  "Executive Summary", "Submarket Overview", "Location and Micro Situation",
  "Asset Description", "Tenure and Ownership", "Income Profile and Tenancy",
  "Tenant Covenant Review", "Planning and Heritage", "ESG and Compliance",
  "Market Commentary", "Valuation Metrics", "Insurance and Reinstatement Cost",
  "Capex Plan", "Business Plan Scenarios", "Exit Strategy",
  "Vendor and Deal Dynamics", "SWOT", "Japan Rationale",
  "Cross Border Tax and Holding Structure", "Currency Risk and Hedging",
  "Further DD Required",
];

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Open", mitigated: "Mitigated", accepted: "Accepted", closed: "Closed",
};

export const RISK_STATUS_TONE: Record<RiskStatus, Tone> = {
  open: "negative", mitigated: "positive", accepted: "caution", closed: "muted",
};

export const RISK_LEVEL_TONE: Record<RiskLevel, Tone> = {
  low: "positive", medium: "caution", high: "negative",
};

// ---- Investment score helpers ----------------------------------------------
/** Tone band for an overall investment score (0–100), aligned to recommendation bands. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 70) return "positive"; // Strong Proceed / Proceed
  if (score >= 55) return "accent"; // Proceed with Caution
  if (score >= 40) return "caution"; // Weak
  return "negative"; // Reject
}

/** Tone band for a single category score (1–10). */
export function pillarTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 7.5) return "positive";
  if (score >= 5.5) return "accent";
  if (score >= 4) return "caution";
  return "negative";
}

/** Tone band for a 1–25 risk score (probability × impact). */
export function riskScoreTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 15) return "negative";
  if (score >= 9) return "caution";
  return "positive";
}
