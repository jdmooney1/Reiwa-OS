// ============================================================================
// Frozen memo assets: the contract. Pure; imports nothing.
// ----------------------------------------------------------------------------
// A finalised memo is a document that has been (or may be) sent. Everything on it
// is frozen at finalisation: memos.content (a copy of the figures), the FX rate
// lock, the committee's minute. A Snapshot's pictures are the same kind of thing,
// so at finalisation each one is COPIED into a private bucket under the MEMO's id,
// and the memo's content points at the copy. Nothing in a final memo points back at
// property_photos, so no later deletion or re-marking of the original can reach it.
//
// A path is content-addressed (a short hash of the bytes). The write never
// overwrites, and a retry after a half-finished attempt lands on the same path
// instead of failing or leaving a second copy.
// ============================================================================

/** The one private bucket for frozen memo assets. Never public. */
export const MEMO_ASSET_BUCKET = "memo-assets";

/** Signed URLs live a minute, like every other private object here. */
export const MEMO_ASSET_SIGNED_URL_TTL_SECONDS = 60;

/** Everything stored is the re-encoded JPEG the photograph already was. */
export const MEMO_ASSET_TYPE = "image/jpeg";

/** A frozen picture is a copy of a stored photograph, which is capped at 15 MB. */
export const MEMO_ASSET_MAX_BYTES = 15 * 1024 * 1024;
export const MEMO_ASSET_EXTENSION = ".jpg";

export type FrozenSlot = "photo" | "map";

/** `memos/<memoId>/<slot>-<hash>.jpg`. The memo id is the folder; the photograph's id appears nowhere. */
export function frozenAssetPath(memoId: string, slot: FrozenSlot, sha256Hex: string): string {
  return `memos/${memoId}/${slot}-${sha256Hex.slice(0, 16)}${MEMO_ASSET_EXTENSION}`;
}

/** Whether a stored path is one this memo owns. A path in a memo's content that fails this is never signed. */
export function isFrozenPathOf(memoId: string, path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`memos/${memoId}/`) && !path.includes("..");
}

/**
 * The stored content with the Snapshot's pictures swapped for their frozen copies.
 * Works on the RAW stored object, so nothing else in it is reshaped, and drops the
 * legacy `photoId` key: after this, the snapshot holds no reference to a photograph.
 */
export function freezeSnapshotContent(
  raw: Record<string, unknown>, frozen: Partial<Record<FrozenSlot, string>>,
): Record<string, unknown> {
  const snap = raw.snapshot as Record<string, unknown> | undefined;
  if (!snap || typeof snap !== "object") return raw;
  const { photoId: _legacy, ...rest } = snap;
  void _legacy;
  const next: Record<string, unknown> = { ...rest };
  for (const slot of ["photo", "map"] as const) {
    const path = frozen[slot];
    if (path) next[slot] = { source: "frozen", path };
  }
  return { ...raw, snapshot: next };
}

/** A live picture reference found in stored content, with the slot it fills. */
export interface LiveRef { slot: FrozenSlot; photoId: string }

/** The live pictures a stored snapshot still points at (including a pre-`photo` legacy `photoId`). */
export function liveRefsIn(raw: Record<string, unknown>): LiveRef[] {
  const snap = raw.snapshot as Record<string, unknown> | undefined;
  if (!snap || typeof snap !== "object") return [];
  const out: LiveRef[] = [];
  const photo = snap.photo as { source?: string; photoId?: string } | null | undefined;
  if (photo && photo.source === "live" && typeof photo.photoId === "string") out.push({ slot: "photo", photoId: photo.photoId });
  else if (!photo && typeof snap.photoId === "string") out.push({ slot: "photo", photoId: snap.photoId });
  const map = snap.map as { source?: string; photoId?: string } | null | undefined;
  if (map && map.source === "live" && typeof map.photoId === "string") out.push({ slot: "map", photoId: map.photoId });
  return out;
}
