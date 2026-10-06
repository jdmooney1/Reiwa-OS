// ============================================================================
// Deal-share rules that need no database. Pure.
// ----------------------------------------------------------------------------
// What a share may be created with, what state it is in, where its link points, and
// the words that must be on the prospect's screen. The rules that DO need a lookup (the
// memos belong to the opportunity and are final) live in src/lib/data/deal-shares.ts.
// ============================================================================
import { AppError } from "@/lib/errors";

import { DEAL_SHARE_TTL_DAYS_MAX } from "@/lib/deal-share/limits";

export { DEAL_SHARE_TTL_DAYS_DEFAULT, DEAL_SHARE_TTL_DAYS_MAX } from "@/lib/deal-share/limits";

export type ShareDocument = "snapshot" | "teaser";

export interface ShareInput {
  prospectName: string;
  prospectEmail: string;
  ttlDays: number;
  /** The final memo version each document is read from; null when that document is not shared. */
  snapshotMemoId: string | null;
  teaserMemoId: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function memoRef(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !UUID.test(v)) throw new AppError("That memo version could not be found.");
  return v.toLowerCase();
}

/** Validate and normalise what an admin typed. Throws AppError with a sentence to show. */
export function validateShareInput(raw: {
  prospectName: unknown; prospectEmail: unknown; ttlDays: unknown; snapshotMemoId: unknown; teaserMemoId: unknown;
}): ShareInput {
  const name = typeof raw.prospectName === "string" ? raw.prospectName.trim() : "";
  if (!name) throw new AppError("Enter the prospect's name.");
  if (name.length > 200) throw new AppError("The prospect's name is too long.");

  const email = typeof raw.prospectEmail === "string" ? raw.prospectEmail.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !EMAIL.test(email)) throw new AppError("Enter a valid email address for the prospect.");

  const days = typeof raw.ttlDays === "number" ? raw.ttlDays : Number(raw.ttlDays);
  if (!Number.isInteger(days) || days < 1 || days > DEAL_SHARE_TTL_DAYS_MAX) {
    throw new AppError(`The link must last between 1 and ${DEAL_SHARE_TTL_DAYS_MAX} days.`);
  }

  const snapshotMemoId = memoRef(raw.snapshotMemoId);
  const teaserMemoId = memoRef(raw.teaserMemoId);
  if (!snapshotMemoId && !teaserMemoId) throw new AppError("Choose at least one document to share.");

  return { prospectName: name, prospectEmail: email, ttlDays: days, snapshotMemoId, teaserMemoId };
}

export type ShareState = "active" | "expired" | "revoked";

/** Revoked beats expired: it is the stronger, deliberate statement. */
export function shareState(r: { expiresAt: string | Date; revokedAt: string | Date | null }, now: Date = new Date()): ShareState {
  if (r.revokedAt) return "revoked";
  return new Date(r.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
}

/**
 * The address a prospect link is built on. Configuration, never the request: a link
 * composed from a forged Host header would hand a prospect an attacker's domain under
 * Reiwa's name. Its own variable, with no fallback to any other surface's: it is a
 * separate surface, and it may one day live on a separate domain. Required to CREATE a link,
 * not to boot, like the investor portal's address is to send an invitation.
 */
export function dealShareOrigin(raw: string | undefined = process.env.DEAL_SHARE_URL): string {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new AppError("The address for prospect links is not configured, so no link was made. Set DEAL_SHARE_URL (for example https://portal.reiwa-capital.com) and try again.");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("DEAL_SHARE_URL is not a valid URL, so no link was made."); }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new AppError("DEAL_SHARE_URL must be an https:// address, so no link was made.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new AppError("DEAL_SHARE_URL must be an origin with no path, query or fragment, so no link was made.");
  }
  return url.origin;
}

export const dealSharePath = (rawToken: string): string => `/deal/${rawToken}`;
export const dealShareLink = (origin: string, rawToken: string): string => `${origin}${dealSharePath(rawToken)}`;
