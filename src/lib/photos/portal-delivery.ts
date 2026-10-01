// ============================================================================
// Investor photo delivery - the only path from an investor to a photograph's bytes.
// ----------------------------------------------------------------------------
// Mirrors documents/secure-delivery.ts (issueDocumentDownload):
//   * The caller presents a PHOTO ID. It never presents, receives or guesses a
//     storage path, and none reaches the browser.
//   * The lookup runs inside withInvestorSession(), which presents nothing but
//     the auth user id. app.investor_photo() (migration 0020) decides, from
//     auth.uid() alone: the photo marked diligence, the investor's own visible
//     entitlement to a published publication of that property, and an
//     entitlement at the diligence tier. This module holds no tier comparison, no
//     status check and no organisation id, so a defect here cannot widen access:
//     the row never arrives.
//   * Every refusal is null - an internal photo, a standard-tier entitlement,
//     another organisation's photo, a withdrawn publication, a malformed or
//     invented id - so no caller can tell "does not exist" from "not allowed".
//   * The signed URL lives sixty seconds. No activity event is written: a page
//     of photographs is many requests, and the trail records deliveries of
//     documents, not page furniture.
//
// SERVER-ONLY.
// ============================================================================
import { withInvestorSession } from "@/lib/db/client";
import { isUuid } from "@/lib/data/portal-feed";
import { signPhotoObject, thumbPathFor } from "@/lib/photos/storage";
import type { PhotoVariant } from "@/lib/photos/constraints";

export async function issuePortalPhotoDownload(
  authUserId: string, photoId: string, variant: PhotoVariant = "full",
): Promise<string | null> {
  if (!isUuid(photoId)) return null;

  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{ object_path: string; mime_type: string }>(
      "select object_path, mime_type from app.investor_photo($1)", [photoId]);
    return rows;
  });
  const r = rows[0];
  if (!r) return null;

  if (variant === "thumb") {
    // A photograph stored before thumbnails existed has none: serve the full
    // image rather than a broken one.
    return (await signPhotoObject(thumbPathFor(r.object_path))) ?? signPhotoObject(r.object_path);
  }
  return signPhotoObject(r.object_path);
}
