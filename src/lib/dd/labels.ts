// Labels and tone treatment for the due diligence tracker.
import type { Tone } from "@/lib/domain";
import type {
  DdStatus, DdJurisdiction, DdPriority,
} from "@/lib/data/deal-file-types";

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
  received: "emphasis",
  reviewed: "positive",
  issue_identified: "negative",
  resolved: "positive",
  not_applicable: "muted",
};

/** Segment colours for the proportional status bar, in DD_STATUS_ORDER order. */
export const DD_STATUS_COLOR: Record<DdStatus, string> = {
  not_started: "#E4DFD6",
  requested: "#BCB5B7",
  in_progress: "#8A7A45",
  received: "#3D2449",
  reviewed: "#4F6B57",
  issue_identified: "#8C4A42",
  resolved: "#3F5A48",
  not_applicable: "#F4F0E5",
};

export const PRIORITY_LABEL: Record<DdPriority, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const PRIORITY_TONE: Record<DdPriority, Tone> = {
  low: "muted", medium: "neutral", high: "caution", critical: "negative",
};

export const JURISDICTION_LABEL: Record<DdJurisdiction, string> = {
  UK: "UK", Netherlands: "Netherlands", Japan: "Japan", "Cross-border": "Cross-Border",
};

export const JURISDICTION_TONE: Record<DdJurisdiction, Tone> = {
  UK: "neutral", Netherlands: "neutral", Japan: "emphasis", "Cross-border": "caution",
};
