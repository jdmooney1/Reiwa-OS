"use server";

// ============================================================================
// Asset photograph server actions (Phase 1: staff only).
// ----------------------------------------------------------------------------
// Same discipline as uploadDocumentAction, and for the same reasons:
//   * Authorised BEFORE a byte is stored: a read-only session is refused up
//     front, and the property is resolved from the OPPORTUNITY on the server -
//     a browser never names the property or supplies a path.
//   * Validated against what the server received: allow-listed type, size
//     ceiling, and the file's own first bytes must agree with its declared type.
//   * RE-ENCODED on the server, always (lib/photos/process.ts): orientation is
//     baked into the pixels and every byte of metadata, GPS included, is dropped.
//     The browser's own shrink is a convenience; this is the control. A full
//     image and a thumbnail are stored, both JPEG, at a random server-generated
//     path in the private bucket, then recorded as `internal`. There is no
//     visibility parameter on upload.
//   * If the row does not land, neither object survives it.
//
// A MAP is a second kind of the same row (migration 0028), uploaded through the same
// action with kind=map: same validation, same re-encode, same internal-until-cleared.
//
// ONE photograph per call. The browser sends them one at a time (it also shrinks
// them first, see components/workspace/photos-section.tsx) so each request stays
// small enough for the platform's request-body ceiling.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { getOpportunity } from "@/lib/data/opportunities";
import {
  recordPhoto, setHeadline, setPhotoVisibility, reorderPhotos, deletePhotoRow,
} from "@/lib/data/property-photos";
import { checkPhoto, isPhotoKind, STORED_PHOTO_TYPE } from "@/lib/photos/constraints";
import { reencodePhoto } from "@/lib/photos/process";
import { newPhotoObjectPath, putPhotoObject, deletePhotoObject, thumbPathFor } from "@/lib/photos/storage";
import { isUuid } from "@/lib/data/portal-feed";
import type { Session } from "@/lib/db/client";

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`, "layout");
  revalidatePath("/pipeline");
}

/** The property this opportunity is about, as this caller may see it, or a refusal. */
async function propertyOf(session: Session, opportunityId: string): Promise<string> {
  if (!session.canWrite) throw new AppError("You do not have permission to change photographs.");
  if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
  const opp = await getOpportunity(session, opportunityId);
  if (!opp) throw new AppError("That opportunity could not be found.");
  if (!opp.propertyId) throw new AppError("This opportunity is not linked to a property, so it cannot hold photographs.");
  return opp.propertyId;
}

/**
 * Upload one photograph. `headline` puts it in the headline slot (the previous
 * headline moves into the gallery); otherwise it joins the end of the gallery.
 */
export async function uploadPhotoAction(
  opportunityId: string, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.photo.upload", { opportunityId }, async () => {
    const propertyId = await propertyOf(session, opportunityId);
    // A building photograph (the default) or a map: the same upload, the same checks,
    // the same internal-until-cleared start. Anything else is refused, not defaulted.
    const rawKind = formData.get("kind");
    const kind = rawKind === null || rawKind === "" ? "building" : rawKind;
    if (!isPhotoKind(kind)) throw new AppError("That is not a kind of picture this property can hold.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a photograph to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkPhoto(file.type, bytes.byteLength, bytes.subarray(0, 16));
    if (!check.ok) throw new AppError(check.reason);

    // The header looked like an image; the body may not decode. That is the
    // person's file, not a fault.
    let processed;
    try {
      processed = await reencodePhoto(bytes);
    } catch {
      throw new AppError("That file could not be read as an image. Try saving it again as a JPEG.");
    }

    // Everything stored is JPEG now, whatever was uploaded.
    const objectPath = newPhotoObjectPath(propertyId, STORED_PHOTO_TYPE);
    try {
      await putPhotoObject(objectPath, processed.full, STORED_PHOTO_TYPE);
      await putPhotoObject(thumbPathFor(objectPath), processed.thumb, STORED_PHOTO_TYPE);
      await recordPhoto(session, {
        propertyId, objectPath, mimeType: STORED_PHOTO_TYPE,
        asHeadline: formData.get("headline") === "1",
        kind,
      });
    } catch (e) {
      // An object with no row is unreachable and unaccounted for: remove both,
      // whichever of the three steps failed.
      await deletePhotoObject(objectPath);
      throw e;
    }
    refresh(opportunityId);
  }, {
    ruleMessage: "That photograph could not be saved.",
  });
}

export async function makeHeadlinePhotoAction(
  opportunityId: string, photoId: string,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.photo.headline", { opportunityId, photoId }, async () => {
    const propertyId = await propertyOf(session, opportunityId);
    if (!isUuid(photoId)) throw new AppError("That photograph could not be found.");
    await setHeadline(session, propertyId, photoId);
    refresh(opportunityId);
  });
}

export async function setPhotoVisibilityAction(
  opportunityId: string, photoId: string, visibility: string,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.photo.visibility", { opportunityId, photoId, visibility }, async () => {
    const propertyId = await propertyOf(session, opportunityId);
    if (!isUuid(photoId)) throw new AppError("That photograph could not be found.");
    await setPhotoVisibility(session, propertyId, photoId, visibility);
    refresh(opportunityId);
  });
}

export async function reorderPhotosAction(
  opportunityId: string, orderedIds: string[],
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.photo.reorder", { opportunityId }, async () => {
    const propertyId = await propertyOf(session, opportunityId);
    if (!Array.isArray(orderedIds) || orderedIds.length > 500 || !orderedIds.every(isUuid)) {
      throw new AppError("That order could not be read.");
    }
    await reorderPhotos(session, propertyId, orderedIds);
    refresh(opportunityId);
  });
}

/** Delete the row AND the stored object. */
export async function deletePhotoAction(
  opportunityId: string, photoId: string,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.photo.delete", { opportunityId, photoId }, async () => {
    const propertyId = await propertyOf(session, opportunityId);
    if (!isUuid(photoId)) throw new AppError("That photograph could not be found.");
    const gone = await deletePhotoRow(session, propertyId, photoId);
    if (!gone) throw new AppError("That photograph could not be found.");
    await deletePhotoObject(gone.objectPath);
    refresh(opportunityId);
  });
}
