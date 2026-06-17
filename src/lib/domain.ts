// Human labels, ordering and accent treatment for domain enums.
// Kept UI-agnostic: components decide how to render the "tone".
import type {
  AssetType, DealStage, DealStatus, Strategy, Recommendation,
  PriorityLevel, DdStatus, RiskStatus, RiskLevel, DdSection, DdJurisdiction,
} from "@/types/database";

export type Tone = "neutral" | "gold" | "positive" | "caution" | "negative" | "muted";

// ---- Pipeline stages (Reiwa pipeline board order) --------------------------
// Note: the DB enum is the canonical lifecycle; the pipeline board adds
// presentational stages (Sourced/LOI/Approved/etc.) mapped here.
export type PipelineStage =
  | "Sourced" | "Screening" | "Underwriting" | "LOI" | "Due Diligence"
  | "IC Review" | "Approved" | "Closed" | "Rejected" | "On Hold";

export const PIPELINE_STAGES: PipelineStage[] = [
  "Sourced", "Screening", "Underwriting", "LOI", "Due Diligence",
  "IC Review", "Approved", "Closed", "Rejected", "On Hold",
];

// Map the persisted deal_stage/status enum to a board column.
export function pipelineStageOf(stage: DealStage, status: DealStatus): PipelineStage {
  if (status === "on_hold") return "On Hold";
  if (status === "dead" || status === "withdrawn") return "Rejected";
  switch (stage) {
    case "sourcing": return "Sourced";
    case "screening": return "Screening";
    case "underwriting": return "Underwriting";
    case "under_offer": return "LOI";
    case "due_diligence": return "Due Diligence";
    case "investment_committee": return "IC Review";
    case "exclusivity":
    case "legals": return "Approved";
    case "completed": return "Closed";
    case "aborted": return "Rejected";
    default: return "Sourced";
  }
}

export const STAGE_LABEL: Record<DealStage, string> = {
  sourcing: "Sourcing",
  screening: "Screening",
  underwriting: "Underwriting",
  due_diligence: "Due Diligence",
  investment_committee: "IC Review",
  under_offer: "Under Offer",
  exclusivity: "Exclusivity",
  legals: "Legals",
  completed: "Completed",
  aborted: "Aborted",
};

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

export const STATUS_LABEL: Record<DealStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  withdrawn: "Withdrawn",
  dead: "Dead",
};

export const STATUS_TONE: Record<DealStatus, Tone> = {
  active: "positive",
  on_hold: "caution",
  completed: "gold",
  withdrawn: "muted",
  dead: "negative",
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
  received: "gold",
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
  UK: "neutral", Netherlands: "neutral", Japan: "gold", "Cross-border": "caution",
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
  if (score >= 55) return "gold"; // Proceed with Caution
  if (score >= 40) return "caution"; // Weak
  return "negative"; // Reject
}

/** Tone band for a single category score (1–10). */
export function pillarTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 7.5) return "positive";
  if (score >= 5.5) return "gold";
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
