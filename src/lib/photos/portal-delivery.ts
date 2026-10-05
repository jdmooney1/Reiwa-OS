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
//   * The signed URL lives sixty seconds.
//
// The `photo_viewed` event (migration 0021) is written ONLY after a signed URL has
// been successfully minted. A refusal writes nothing, so the activity trail
// records deliveries, never attempts - and a photograph above the investor's tier
// never reaches the insert, because it never reaches this point. It is written at
// most once per photo and rendition per half hour: one page of photographs is many
// requests, and an engagement record that lists each reload is noise.
//
// SERVER-ONLY.
// ============================================================================
import { withInvestorSession } from "@/lib/db/client";
import { isUuid } from "@/lib/data/portal-feed";
import { signPhotoObject, thumbPathFor } from "@/lib/photos/storage";
import type { PhotoVariant } from "@/lib/photos/constraints";

/** One view of a photograph, per rendition, is recorded per this many minutes. */
const VIEW_EVENT_WINDOW_MINUTES = 30;

export async function issuePortalPhotoDownload(
  authUserId: string, photoId: string, variant: PhotoVariant = "full",
): Promise<string | null> {
  if (!isUuid(photoId)) return null;

  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{ object_path: string; mime_type: string; publication_id: string }>(
      "select object_path, mime_type, publication_id from app.investor_photo($1)", [photoId]);
    return rows;
  });
  const r = rows[0];
  if (!r) return null;

  // A photograph stored before thumbnails existed has none: serve the full
  // image rather than a broken one.
  const signedUrl = variant === "thumb"
    ? (await signPhotoObject(thumbPathFor(r.object_path))) ?? (await signPhotoObject(r.object_path))
    : await signPhotoObject(r.object_path);
  // The store could not produce a link (missing object, storage outage). Nothing
  // was delivered, so nothing is recorded.
  if (!signedUrl) return null;

  await recordPhotoViewed(authUserId, { publicationId: r.publication_id, photoId, variant });
  return signedUrl;
}

/**
 * Write the `photo_viewed` event for a delivery that has happened.
 *
 * Kept private to this module so the event cannot be emitted from anywhere that
 * has not just minted a signed URL. Never throws: a failed activity write must
 * not fail a view the investor is entitled to.
 */
async function recordPhotoViewed(
  authUserId: string,
  view: { publicationId: string; photoId: string; variant: PhotoVariant },
): Promise<void> {
  try {
    await withInvestorSession(authUserId, async (tx) => {
      // The investor's own SELECT policy lets the NOT EXISTS see their earlier
      // events and nobody else's; the insert policy pins both ids to the caller.
      await tx.query(
        `insert into investor_activity_events(
           investor_contact_id, investor_org_id, event_type,
           publication_id, photo_id, context)
         select app.current_investor_contact_id(), app.current_investor_org_id(),
                'photo_viewed', $1::uuid, $2::uuid, $3::jsonb
          where not exists (
            select 1 from investor_activity_events e
             where e.photo_id = $2::uuid
               and e.event_type = 'photo_viewed'
               and e.investor_contact_id = app.current_investor_contact_id()
               and e.context ->> 'variant' = ($3::jsonb) ->> 'variant'
               and e.occurred_at > now() - make_interval(mins => $4::int))`,
        [view.publicationId, view.photoId, JSON.stringify({ variant: view.variant }), VIEW_EVENT_WINDOW_MINUTES]);
    });
  } catch {
    // Deliberately swallowed: the bytes were authorised and delivered.
  }
}
