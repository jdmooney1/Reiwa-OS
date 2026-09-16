// ============================================================================
// Opportunity status - three axes, one label.
// ----------------------------------------------------------------------------
// The brief asks for one flat status list. The data keeps three independent
// axes, because collapsing them destroys real intelligence (see docs/17 D2):
//
//   stage         how far REIWA has taken it        drives asset conversion
//   status        Reiwa's disposition                active / watchlist / passed
//   marketStatus  what happened to the ASSET         independent of us
//
// "Withdrawn" as a single status cannot distinguish "we passed" from "the vendor
// pulled it", and that distinction is the proprietary history the whole system
// exists to accumulate. displayStatus() renders the flat label the brief asks
// for, without the data having to lose the structure underneath.
//
// Pure module: safe to import from client components.
// ============================================================================

export type OppStage =
  | "inbox" | "screening" | "underwriting" | "ic" | "investor_ready" | "approved" | "acquired"
  // Retained for rows written before migration 0007.
  | "new";

export type OppStatus =
  | "active" | "watchlist" | "rejected" | "withdrawn" | "lost" | "converted";

export type MarketStatus =
  | "available" | "under_offer" | "sold" | "withdrawn" | "unknown";

/** Reiwa's own position in a process, distinct from the asset's market status. */
export type ReiwaPosition =
  | "none" | "bid_submitted" | "under_offer" | "exclusive" | "legals";

export const OPP_STAGES: OppStage[] = [
  "inbox", "screening", "underwriting", "ic", "investor_ready", "approved", "acquired",
];

export const MARKET_STATUSES: MarketStatus[] = [
  "available", "under_offer", "sold", "withdrawn", "unknown",
];

export const REIWA_POSITIONS: ReiwaPosition[] = [
  "none", "bid_submitted", "under_offer", "exclusive", "legals",
];

export const STAGE_LABEL: Record<OppStage, string> = {
  new: "New",
  inbox: "New",
  screening: "Screening",
  underwriting: "Underwriting",
  ic: "IC Review",
  investor_ready: "Investor Ready",
  approved: "Approved",
  acquired: "Acquired",
};

export const STATUS_LABEL: Record<OppStatus, string> = {
  active: "Active",
  watchlist: "Watchlist",
  rejected: "Pass",
  withdrawn: "Withdrawn",
  lost: "Lost",
  converted: "Converted",
};

export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  available: "Available",
  under_offer: "Under Offer",
  sold: "Sold",
  withdrawn: "Withdrawn from market",
  unknown: "Unknown",
};

export const REIWA_POSITION_LABEL: Record<ReiwaPosition, string> = {
  none: "No position",
  bid_submitted: "Bid submitted",
  under_offer: "Reiwa under offer",
  exclusive: "Exclusivity",
  legals: "Legals",
};

export interface StatusInput {
  stage: OppStage;
  status: OppStatus;
  marketStatus?: MarketStatus | null;
  reiwaPosition?: ReiwaPosition | null;
  archivedAt?: string | null;
  /** True when this opportunity has a live investor publication. */
  isPublished?: boolean;
}

export type DisplayTone = "neutral" | "gold" | "positive" | "caution" | "negative" | "muted";

export interface DisplayStatus {
  label: string;
  tone: DisplayTone;
  /** The axis the label came from, so the UI can explain itself on hover. */
  axis: "stage" | "status" | "market" | "position" | "publication" | "archive";
  detail: string;
}

/**
 * The single flat label. Precedence runs from the most decisive fact to the
 * least: an archived record is archived whatever its stage said, and Reiwa's own
 * position outranks the market's because it is the more specific claim.
 */
export function displayStatus(input: StatusInput): DisplayStatus {
  const {
    stage, status, marketStatus = "unknown", reiwaPosition = "none",
    archivedAt = null, isPublished = false,
  } = input;

  if (archivedAt && status !== "converted") {
    return {
      label: status === "rejected" ? "Pass" : "Archived",
      tone: "muted",
      axis: "archive",
      detail: status === "rejected"
        ? "Reiwa passed on this opportunity."
        : `Archived (${STATUS_LABEL[status]}).`,
    };
  }

  if (status === "converted" || stage === "acquired") {
    return { label: "Acquired", tone: "gold", axis: "stage", detail: "Converted to an owned asset." };
  }

  if (marketStatus === "sold") {
    return {
      label: "Sold", tone: "muted", axis: "market",
      detail: "The asset sold. Kept for market intelligence.",
    };
  }

  if (reiwaPosition && reiwaPosition !== "none") {
    return {
      label: REIWA_POSITION_LABEL[reiwaPosition],
      tone: "positive", axis: "position",
      detail: "Reiwa's own position in the sale process.",
    };
  }

  if (marketStatus === "under_offer") {
    return {
      label: "Under Offer (third party)", tone: "caution", axis: "market",
      detail: "Another party is under offer. Reiwa holds no position.",
    };
  }

  if (marketStatus === "withdrawn") {
    return {
      label: "Withdrawn", tone: "muted", axis: "market",
      detail: "The vendor withdrew the asset from the market.",
    };
  }

  if (status === "watchlist") {
    return { label: "Watchlist", tone: "neutral", axis: "status", detail: "Tracked, not being progressed." };
  }
  if (status === "rejected") {
    return { label: "Pass", tone: "muted", axis: "status", detail: "Reiwa passed on this opportunity." };
  }
  if (status === "lost") {
    return { label: "Lost", tone: "negative", axis: "status", detail: "Reiwa bid and did not win." };
  }
  if (status === "withdrawn") {
    return { label: "Withdrawn", tone: "muted", axis: "status", detail: "Reiwa withdrew from the process." };
  }

  if (isPublished) {
    return { label: "Published", tone: "gold", axis: "publication", detail: "Live on the Investment Portal." };
  }

  return {
    label: STAGE_LABEL[stage],
    tone: stage === "investor_ready" ? "gold" : stage === "inbox" ? "neutral" : "positive",
    axis: "stage",
    detail: `Reiwa stage: ${STAGE_LABEL[stage]}.`,
  };
}

/**
 * Whether an opportunity may be prepared for the Investment Portal.
 * The gate the brief asks for in section 17, in one place.
 */
export function canPublish(input: StatusInput): { allowed: boolean; reason: string } {
  if (input.archivedAt) return { allowed: false, reason: "Archived opportunities cannot be published." };
  if (input.status === "rejected") return { allowed: false, reason: "Reiwa has passed on this opportunity." };
  if (input.status === "watchlist") {
    return { allowed: false, reason: "Watchlist opportunities are not investor-facing." };
  }
  if (!["investor_ready", "approved", "acquired"].includes(input.stage)) {
    return { allowed: false, reason: 'Mark the opportunity "Investor Ready" before publishing.' };
  }
  return { allowed: true, reason: "" };
}

/** The event type a market status change should record on the property timeline. */
export function marketStatusEvent(from: MarketStatus | null, to: MarketStatus): string | null {
  if (from === to) return null;
  switch (to) {
    case "sold": return "sold";
    case "withdrawn": return "withdrawn";
    case "under_offer": return "market_status_changed";
    case "available": return from === "withdrawn" ? "relaunched" : "market_status_changed";
    default: return "market_status_changed";
  }
}
