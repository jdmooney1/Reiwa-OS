// Human labels, ordering and accent treatment for domain enums.
// Kept UI-agnostic: components decide how to render the "tone".
import type {
  AssetType, DealStage, DealStatus, Strategy, Recommendation,
  PriorityLevel, DdStatus, RiskStatus, RiskLevel, DdCategory,
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
  strong_pursue: "Strong Pursue",
  pursue: "Pursue",
  conditional: "Conditional",
  hold: "Hold",
  pass: "Pass",
};

export const RECOMMENDATION_TONE: Record<Recommendation, Tone> = {
  strong_pursue: "positive",
  pursue: "positive",
  conditional: "caution",
  hold: "muted",
  pass: "negative",
};

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const PRIORITY_TONE: Record<PriorityLevel, Tone> = {
  low: "muted", medium: "neutral", high: "caution", critical: "negative",
};

export const DD_STATUS_LABEL: Record<DdStatus, string> = {
  open: "Open", in_progress: "In Progress", complete: "Complete",
  blocked: "Blocked", na: "N/A",
};

export const DD_STATUS_TONE: Record<DdStatus, Tone> = {
  open: "muted", in_progress: "caution", complete: "positive",
  blocked: "negative", na: "muted",
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

export const DD_CATEGORIES: DdCategory[] = [
  "Legal", "Tax", "Technical", "Planning", "ESG", "Commercial",
  "Leasing", "Valuation", "Insurance", "FX", "Japan Tax", "Structure",
];

// ---- Investment score helpers ----------------------------------------------
/** Tone band for an out-of-ten pillar / overall score. */
export function scoreTone(score: number | null | undefined): Tone {
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
