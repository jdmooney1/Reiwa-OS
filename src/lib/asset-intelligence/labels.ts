// Display labels & tones for Asset Intelligence enums (UI-agnostic).
import type { Tone } from "@/lib/domain";
import type {
  LifecycleStage, RefiStatus, DecisionStatus, ActionPriority, ActionStatus,
  LeaseStatus, EventType, MilestoneStatus, CapexStatus,
} from "@/lib/asset-intelligence/types";

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  underwriting: "Underwriting", transaction: "Transaction", operating: "Operating",
  development: "Development", stabilising: "Stabilising", exit: "Exit", realised: "Realised",
};
export const LIFECYCLE_TONE: Record<LifecycleStage, Tone> = {
  underwriting: "muted", transaction: "caution", operating: "positive",
  development: "gold", stabilising: "caution", exit: "neutral", realised: "muted",
};

export const REFI_LABEL: Record<RefiStatus, string> = {
  in_place: "In Place", monitoring: "Monitoring", refinancing: "Refinancing",
  maturity_approaching: "Maturity Approaching", breach_risk: "Breach Risk",
};
export const REFI_TONE: Record<RefiStatus, Tone> = {
  in_place: "positive", monitoring: "neutral", refinancing: "caution",
  maturity_approaching: "caution", breach_risk: "negative",
};

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  open: "Open", required: "Required", decided: "Decided", deferred: "Deferred", rejected: "Rejected",
};
export const DECISION_STATUS_TONE: Record<DecisionStatus, Tone> = {
  open: "caution", required: "negative", decided: "positive", deferred: "muted", rejected: "muted",
};

export const ACTION_PRIORITY_LABEL: Record<ActionPriority, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};
export const ACTION_PRIORITY_TONE: Record<ActionPriority, Tone> = {
  low: "muted", medium: "neutral", high: "caution", urgent: "negative",
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  open: "Open", in_progress: "In Progress", blocked: "Blocked", complete: "Complete",
};

export const LEASE_STATUS_LABEL: Record<LeaseStatus, string> = {
  occupied: "Occupied", vacant: "Vacant", under_offer: "Under Offer",
  holdover: "Holdover", in_fit_out: "In Fit-Out",
};
export const LEASE_STATUS_TONE: Record<LeaseStatus, Tone> = {
  occupied: "positive", vacant: "negative", under_offer: "caution",
  holdover: "caution", in_fit_out: "gold",
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  rent_review: "Rent Review", lease_break: "Lease Break", lease_expiry: "Lease Expiry",
  refinancing: "Refinancing", loan_maturity: "Loan Maturity",
  construction_milestone: "Construction Milestone", planning_deadline: "Planning Deadline",
  valuation: "Valuation", tax_deadline: "Tax Deadline", hedge_expiry: "Hedge Expiry",
};

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  not_started: "Not Started", in_progress: "In Progress", complete: "Complete",
  delayed: "Delayed", at_risk: "At Risk",
};
export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, Tone> = {
  not_started: "muted", in_progress: "caution", complete: "positive",
  delayed: "negative", at_risk: "negative",
};

export const CAPEX_STATUS_LABEL: Record<CapexStatus, string> = {
  planned: "Planned", approved: "Approved", committed: "Committed",
  in_progress: "In Progress", complete: "Complete", on_hold: "On Hold",
};
