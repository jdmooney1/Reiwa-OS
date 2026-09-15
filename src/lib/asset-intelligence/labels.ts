// Display labels & tones for Asset Intelligence enums (UI-agnostic).
import type { Tone } from "@/lib/domain";
import type { LifecycleStage, DecisionStatus } from "@/lib/asset-intelligence/types";

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  underwriting: "Underwriting", transaction: "Transaction", operating: "Operating",
  development: "Development", stabilising: "Stabilising", exit: "Exit", realised: "Realised",
};
export const LIFECYCLE_TONE: Record<LifecycleStage, Tone> = {
  underwriting: "muted", transaction: "caution", operating: "positive",
  development: "accent", stabilising: "caution", exit: "neutral", realised: "muted",
};

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  open: "Open", required: "Required", decided: "Decided", deferred: "Deferred", rejected: "Rejected",
};
export const DECISION_STATUS_TONE: Record<DecisionStatus, Tone> = {
  open: "caution", required: "negative", decided: "positive", deferred: "muted", rejected: "muted",
};
