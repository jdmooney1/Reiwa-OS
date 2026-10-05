// ============================================================================
// Where a Snapshot picture is fetched from. Pure.
// ----------------------------------------------------------------------------
// A live picture goes through the staff photograph route by photograph id. A
// FROZEN picture goes through the memo's own route, keyed by the memo and the slot
// ("photo" or "map"), never by a photograph id and never by a storage path: the
// route reads the path from the memo row, so a frozen picture cannot resolve back
// to property_photos from here or from there.
// ============================================================================
import type { SnapshotImage } from "@/lib/memo/compose";

export type SnapshotSlot = "photo" | "map";
export const SNAPSHOT_SLOTS: readonly SnapshotSlot[] = ["photo", "map"];
export const isSnapshotSlot = (v: unknown): v is SnapshotSlot => v === "photo" || v === "map";

/** The URL for a picture, or null when it cannot be drawn (a frozen picture needs its memo's id). */
export function snapshotImageUrl(
  image: SnapshotImage | null | undefined, memoId: string | null | undefined, slot: SnapshotSlot,
): string | null {
  if (!image) return null;
  if (image.source === "live") return `/api/asset-photos/${image.photoId}`;
  return memoId ? `/api/memo-assets/${memoId}/${slot}` : null;
}
