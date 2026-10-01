// ============================================================================
// Photo delivery - the only path from a member of staff to a photograph's bytes.
// ----------------------------------------------------------------------------
// Built to the same shape as documents/internal-delivery.ts:
//   * The caller presents a PHOTO ID. It never presents, receives or guesses a
//     storage path, and none reaches the browser.
//   * The lookup runs inside withSession(), so `property_photos_select`
//     (`app.has_org(org_id)`, migration 0019) decides whether the row exists for
//     this caller. No org comparison is written here.
//   * The role and the photo's visibility are re-checked on EVERY call by
//     mayReadPhoto(): nothing is cached, nothing is remembered from an earlier
//     request, and a role changed since the page rendered takes effect at once.
//   * Every refusal is null, so a photo in another organisation, a deleted photo,
//     a photo above the caller's tier and an invented uuid are indistinguishable.
//   * The signed URL lives sixty seconds.
//
// SERVER-ONLY.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { isUuid } from "@/lib/data/portal-feed";
import { signPhotoObject } from "@/lib/photos/storage";
import { mayReadPhoto } from "@/lib/photos/access";
import { isPhotoVisibility } from "@/lib/photos/constraints";

export async function issuePhotoDownload(
  session: Session, photoId: string,
): Promise<string | null> {
  if (!isUuid(photoId)) return null;
  // Before the database is even asked: a role that may read no photographs at
  // all does not get to learn whether this one exists.
  if (!mayReadPhoto(session.role, "internal")) return null;

  const row = await withSession(session, async (tx) => {
    const { rows } = await tx.query<{ object_path: string; visibility: string }>(
      "select object_path, visibility from property_photos where photo_id = $1", [photoId]);
    return rows[0] ?? null;
  });
  if (!row || !isPhotoVisibility(row.visibility)) return null;
  if (!mayReadPhoto(session.role, row.visibility)) return null;

  return signPhotoObject(row.object_path);
}
