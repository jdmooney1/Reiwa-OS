// Human labels for the investor activity record (P5), internal admin surface.
// Each label states what was recorded — never an interpretation of it.
import type { Tone } from "@/lib/domain";
import type { ActivityEventType } from "@/lib/activity-events";
import type { RequestType, RequestStatus } from "@/lib/data/investor-portal";

export const EVENT_LABEL: Record<ActivityEventType, string> = {
  login: "Signed in",
  opportunity_viewed: "Opened opportunity",
  saved: "Saved",
  unsaved: "Removed from saved",
  compared: "Compared",
  document_viewed: "Viewed document",
  document_downloaded: "Downloaded document",
  information_requested: "Requested information",
};

export const EVENT_TONE: Record<ActivityEventType, Tone> = {
  login: "muted",
  opportunity_viewed: "neutral",
  saved: "gold",
  unsaved: "muted",
  compared: "neutral",
  document_viewed: "neutral",
  document_downloaded: "gold",
  information_requested: "positive",
};

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  information: "More information",
  diligence_access: "Diligence access",
  meeting: "Discuss opportunity",
  other: "Other",
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  closed: "Closed",
};

export const REQUEST_STATUS_TONE: Record<RequestStatus, Tone> = {
  new: "caution",
  acknowledged: "neutral",
  in_progress: "gold",
  closed: "muted",
};

/** "3 minutes ago" / "12 Mar 2026" — a plain restatement of the timestamp. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
