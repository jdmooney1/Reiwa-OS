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
//   * Stored at a random, server-generated path in the private bucket, then
//     recorded as `internal`. There is no visibility parameter on upload.
//   * If the row does not land, the object does not survive it.
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
import { checkPhoto } from "@/lib/photos/constraints";
import { newPhotoObjectPath, putPhotoObject, deletePhotoObject } from "@/lib/photos/storage";
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

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a photograph to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkPhoto(file.type, bytes.byteLength, bytes.subarray(0, 16));
    if (!check.ok) throw new AppError(check.reason);

    const objectPath = newPhotoObjectPath(propertyId, check.mimeType);
    await putPhotoObject(objectPath, bytes, check.mimeType);
    try {
      await recordPhoto(session, {
        propertyId, objectPath, mimeType: check.mimeType,
        asHeadline: formData.get("headline") === "1",
      });
    } catch (e) {
      // An object with no row is unreachable and unaccounted for.
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
