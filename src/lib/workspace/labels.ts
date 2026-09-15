// Display vocabulary for the internal opportunity workspace.
// Shared by the header, the nav and every section, so one status reads the same
// everywhere in the file.
import type { Tone } from "@/lib/domain";
import type { OppStage, OppStatus, OppPriority } from "@/lib/data/opportunity-types";
import type { CaseStatus } from "@/lib/data/underwriting-types";
import type { IcOutcome } from "@/lib/data/ic-decisions";
import type { DdStatus } from "@/types/database";

export const STAGE_LABEL: Record<OppStage, string> = {
  new: "New", screening: "Screening", underwriting: "Underwriting",
  ic: "IC", approved: "Approved", acquired: "Acquired",
};

export const STATUS_LABEL: Record<OppStatus, string> = {
  active: "Active", rejected: "Rejected", withdrawn: "Withdrawn",
  lost: "Lost", converted: "Converted",
};

export const STATUS_TONE: Record<OppStatus, Tone> = {
  active: "positive", rejected: "negative", withdrawn: "muted",
  lost: "negative", converted: "accent",
};

export const PRIORITY_LABEL: Record<OppPriority, string> = {
  low: "Low", medium: "Medium", high: "High",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  off_market: "Off-market", broker_marketed: "Broker marketed",
  direct_approach: "Direct approach", referral: "Referral",
  existing_relationship: "Existing relationship", other: "Other",
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: "Draft", current: "Working", approved: "Approved", superseded: "Superseded",
};

export const CASE_STATUS_TONE: Record<CaseStatus, Tone> = {
  draft: "muted", current: "accent", approved: "positive", superseded: "muted",
};

export const IC_OUTCOME_LABEL: Record<IcOutcome, string> = {
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  deferred: "Deferred",
  rejected: "Rejected",
};

export const IC_OUTCOME_TONE: Record<IcOutcome, Tone> = {
  approved: "positive", approved_with_conditions: "caution",
  deferred: "neutral", rejected: "negative",
};

export const DD_STATUS_LABEL: Record<DdStatus, string> = {
  not_started: "Not started", requested: "Requested", in_progress: "In progress",
  received: "Received", reviewed: "Reviewed", issue_identified: "Issue",
  resolved: "Resolved", not_applicable: "N/A",
};

export const DD_STATUS_TONE: Record<DdStatus, Tone> = {
  not_started: "muted", requested: "neutral", in_progress: "caution",
  received: "accent", reviewed: "positive", issue_identified: "negative",
  resolved: "positive", not_applicable: "muted",
};

export const SEVERITY_LABEL: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const SEVERITY_TONE: Record<string, Tone> = {
  low: "muted", medium: "caution", high: "negative", critical: "negative",
};

export const RISK_STATUS_LABEL: Record<string, string> = {
  open: "Open", mitigated: "Mitigated", accepted: "Accepted", closed: "Closed",
};

export const RISK_STATUS_TONE: Record<string, Tone> = {
  open: "negative", mitigated: "positive", accepted: "caution", closed: "muted",
};
