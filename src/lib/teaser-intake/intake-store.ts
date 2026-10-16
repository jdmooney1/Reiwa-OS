// ============================================================================
// Where a dropped teaser waits while it is read and reviewed. SERVER-ONLY.
// ----------------------------------------------------------------------------
// A teaser is often larger than a server action may carry (the platform caps a
// request near 4.5 MB), so the browser sends the bytes straight to the private
// document bucket on a signed, single-use upload URL that the server minted for
// a path the server chose. Nothing about the path comes from the browser.
//
// THE PATH NAMES ITS OWNER. An intake object lives at
//   intake/<staff user id>/<random uuid>.<ext>
// and every later step re-derives that prefix from the session and refuses any
// other path, so one person's upload can never be read, promoted or deleted by
// another, and no step can be pointed at a deal's or a publication's files.
//
// AN INTAKE OBJECT IS TRANSIENT. It becomes an opportunity document (copied to
// the opportunity's own folder, recorded, then the intake copy removed), or it
// is discarded, or it is swept after a day the next time its owner drops a file.
// The bucket stays private throughout; there is no read URL for an intake object.
//
// THE BYTES ARE CHECKED, NOT THE LABEL. A direct upload skips the server's
// MIME check, so every read here sniffs the file's own signature and size
// before the bytes go to the reader or become a document.
// ============================================================================
import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DOCUMENT_BUCKET, ALLOWED_DOCUMENT_TYPES } from "@/lib/documents/constraints";
import { newOpportunityObjectPath } from "@/lib/documents/storage";
import { AppError } from "@/lib/errors";
import {
  MAX_INTAKE_BYTES, sniffIntakeType, isIntakePathFor, intakeFolder, maxBytesFor, tooLargeMessage, type IntakeType,
} from "@/lib/teaser-intake/files";

export { MAX_INTAKE_BYTES, INTAKE_TYPES, type IntakeType } from "@/lib/teaser-intake/files";

/** Intake objects older than this are removed when their owner next drops a file. */
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

export interface IntakeUpload {
  path: string;
  signedUrl: string;
}

/** A fresh server-chosen path, and a single-use URL the browser may PUT to. */
export async function createIntakeUpload(userId: string, type: IntakeType): Promise<IntakeUpload> {
  const path = `${intakeFolder(userId)}/${randomUUID()}${ALLOWED_DOCUMENT_TYPES[type]}`;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw new Error(`Could not prepare the upload: ${error?.message ?? "no URL"}`);
  return { path, signedUrl: data.signedUrl };
}

export interface IntakeFile {
  bytes: Uint8Array;
  type: IntakeType;
}

/** Read an intake object back, refusing any path that is not this person's, and any file that is not what it claims. */
export async function readIntakeObject(userId: string, path: string): Promise<IntakeFile> {
  if (!isIntakePathFor(userId, path)) throw new AppError("That upload could not be found. Drop the file again.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).download(path);
  if (error || !data) throw new AppError("That upload could not be found. Drop the file again.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength === 0) throw new AppError("The uploaded file is empty.");
  if (bytes.byteLength > MAX_INTAKE_BYTES) throw new AppError(tooLargeMessage("application/pdf"));
  const type = sniffIntakeType(bytes);
  if (!type) throw new AppError("The file is not a PDF, PNG or JPEG.");
  if (bytes.byteLength > maxBytesFor(type)) throw new AppError(tooLargeMessage(type));
  // The extension the server chose must agree with what the bytes are.
  if (!path.endsWith(ALLOWED_DOCUMENT_TYPES[type])) throw new AppError("The file is not the type it was uploaded as. Drop it again.");
  return { bytes, type };
}

/**
 * Copy an intake object into an opportunity's own folder and return the new
 * path. The intake copy is left in place: the caller removes it only once the
 * document row has landed, so a failure in between loses nothing.
 */
export async function promoteIntakeObject(userId: string, path: string, opportunityId: string, type: IntakeType): Promise<string> {
  if (!isIntakePathFor(userId, path)) throw new AppError("That upload could not be found. Drop the file again.");
  const admin = createSupabaseAdminClient();
  const target = newOpportunityObjectPath(opportunityId, type);
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).copy(path, target);
  if (error) throw new Error(`Could not file the teaser with the deal: ${error.message}`);
  return target;
}

/** Remove one of this person's intake objects. Any other path is ignored, never deleted. */
export async function removeIntakeObject(userId: string, path: string): Promise<void> {
  if (!isIntakePathFor(userId, path)) return;
  const admin = createSupabaseAdminClient();
  await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
}

/** Remove a promoted copy whose document row did not land. Only ever called on a path this request just created. */
export async function removePromotedObject(path: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
}

/** Best-effort: clear this person's abandoned intake files. Never throws. */
export async function sweepStaleIntake(userId: string, now = Date.now()): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const folder = intakeFolder(userId);
    const { data } = await admin.storage.from(DOCUMENT_BUCKET).list(folder, { limit: 100 });
    const stale = (data ?? [])
      .filter((o) => o.created_at && now - new Date(o.created_at).getTime() > SWEEP_AFTER_MS)
      .map((o) => `${folder}/${o.name}`)
      .filter((p) => isIntakePathFor(userId, p));
    if (stale.length) await admin.storage.from(DOCUMENT_BUCKET).remove(stale);
  } catch {
    // A sweep that fails leaves files for the next one; it must never block an upload.
  }
}
