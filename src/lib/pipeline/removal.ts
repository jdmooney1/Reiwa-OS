// ============================================================================
// Taking a deal off the pipeline: the four reasons, and what each one records. Pure.
// ----------------------------------------------------------------------------
// A deal is never deleted. Removing it ARCHIVES it: its status moves to an outcome, it leaves the
// board and sits in the Archived list, and it can be restored. The record of what happened to it
// (sold, withdrawn, lost, passed) is the longitudinal history this system exists to keep.
//
// "Sold" means the property is no longer available: the vendor sold it, or it came off the market.
// That is not something WE lost, so it is stored as the Withdrawn status; the timeline event is
// what says it was a sale. "Lost" is for a deal we were in and did not win. "We passed" is our
// own decision, stored as Rejected. No new status is needed, so there is no schema change.
// ============================================================================
export type RemovalReason = "sold" | "withdrawn" | "lost" | "passed";
export const REMOVAL_REASON_ORDER: readonly RemovalReason[] = ["sold", "withdrawn", "lost", "passed"];

/** The statuses a removal can write. Never "converted" (it has an asset) and never "active". */
export type RemovedStatus = "withdrawn" | "lost" | "rejected";

export const REMOVAL_REASONS: Record<RemovalReason, {
  label: string; hint: string; status: RemovedStatus;
  /** The property-timeline event recorded with it, or null for none. */
  event: "sold" | "withdrawn" | "reiwa_passed" | null;
  headline: string;
}> = {
  sold: { label: "Sold or no longer available", hint: "The vendor sold it, or it is off the market", status: "withdrawn", event: "sold", headline: "Sold or no longer available" },
  withdrawn: { label: "Withdrawn from the market", hint: "The vendor pulled it", status: "withdrawn", event: "withdrawn", headline: "Withdrawn from the market" },
  lost: { label: "Lost", hint: "We were in it and did not win it", status: "lost", event: null, headline: "Lost" },
  passed: { label: "We passed", hint: "Our decision not to pursue it", status: "rejected", event: "reiwa_passed", headline: "Passed on by Reiwa" },
};

export function isRemovalReason(v: unknown): v is RemovalReason {
  return v === "sold" || v === "withdrawn" || v === "lost" || v === "passed";
}

/** Statuses a deal can be removed FROM, and restored FROM. */
export const REMOVABLE_FROM: readonly string[] = ["active"];
export const RESTORABLE_FROM: readonly string[] = ["rejected", "withdrawn", "lost"];

export const NOTE_MAX = 500;

/** The note as stored: trimmed, control characters out, capped, null when empty. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, NOTE_MAX);
  return t === "" ? null : t;
}
