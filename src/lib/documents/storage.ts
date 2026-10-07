// ============================================================================
// Private document store — Supabase Storage bucket `publication-documents`.
// ----------------------------------------------------------------------------
// The bucket is PRIVATE. There is no public URL for any object in it and none is
// ever minted: the only way a byte leaves this store is a signed URL created
// server-side, for sixty seconds, after the database has already agreed that
// this investor may read this document (see secure-delivery.ts).
//
// Two rules hold everywhere in this module:
//
//   * An object path is SERVER-GENERATED and random. A browser never supplies
//     one, and nothing here accepts a caller-provided path for an upload. The
//     path of an existing object is read back from `publication_documents` —
//     that row, not the request, is the authority.
//   * Content is validated before it is stored: an allow-listed MIME type and a
//     size ceiling, both checked on the server regardless of what the browser
//     claimed. The rules themselves live in ./constraints, which the admin UI
//     also reads; only the Supabase calls are here.
//
// SERVER-ONLY. This module uses the secret key and must never be imported into
// a client component.
// ============================================================================
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_BUCKET, SIGNED_URL_TTL_SECONDS, MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_TYPES,
} from "@/lib/documents/constraints";

export {
  DOCUMENT_BUCKET, SIGNED_URL_TTL_SECONDS, MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_TYPES,
  checkUpload, safeFileName, type UploadCheck,
} from "@/lib/documents/constraints";

/**
 * A fresh, unguessable object path for a version's document.
 *
 * The version id is a folder for operator legibility only — it confers nothing,
 * because the bucket is private and every read is authorised against the
 * database first. The file name itself is a random UUID: two uploads of the
 * same file never collide, and no part of the path is derived from anything a
 * browser supplied.
 */
export function newObjectPath(versionId: string, mimeType: string): string {
  const extension = ALLOWED_DOCUMENT_TYPES[mimeType] ?? "";
  return `publications/${versionId}/${randomUUID()}${extension}`;
}

/**
 * The same, for an internal opportunity document.
 *
 * A separate prefix so the two kinds of object are legible apart in the bucket,
 * and nothing more: the prefix confers no access, exactly as `publications/`
 * confers none. Both are private, both are reachable only by a signed URL minted
 * after the database has agreed, and the path here is as server-generated and as
 * unguessable as the publication one.
 */
export function newOpportunityObjectPath(opportunityId: string, mimeType: string): string {
  const extension = ALLOWED_DOCUMENT_TYPES[mimeType] ?? "";
  return `opportunities/${opportunityId}/${randomUUID()}${extension}`;
}

/**
 * Create the private bucket if it is absent. Idempotent, and it never flips an
 * existing bucket to public — if somebody has made it public, that is reported
 * rather than silently corrected, because it means objects may already have
 * been exposed.
 */
export async function ensureDocumentBucket(): Promise<{ created: boolean; isPublic: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.storage.getBucket(DOCUMENT_BUCKET);
  if (existing) return { created: false, isPublic: Boolean(existing.public) };

  const { error } = await admin.storage.createBucket(DOCUMENT_BUCKET, {
    public: false,
    fileSizeLimit: MAX_DOCUMENT_BYTES,
    allowedMimeTypes: Object.keys(ALLOWED_DOCUMENT_TYPES),
  });
  if (error) throw new Error(`Could not create the ${DOCUMENT_BUCKET} bucket: ${error.message}`);
  return { created: true, isPublic: false };
}

/** Store an object at a server-generated path. Never overwrites. */
export async function putDocumentObject(
  objectPath: string, body: ArrayBuffer | Uint8Array, mimeType: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(objectPath, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Could not store the document: ${error.message}`);
}

/**
 * Mint a short-lived signed URL for an object.
 *
 * Callers must already have established that the requester may read it — this
 * function does no authorisation of its own, and the only request path that
 * reaches it goes through secure-delivery.ts.
 */
export async function signDocumentObject(
  objectPath: string, downloadAs?: string | null,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS,
      downloadAs ? { download: downloadAs } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Remove an object.
 *
 * THE OBJECT'S OWNER IS ITS ROW, and each object has exactly one (a unique index on
 * `publication_documents.storage_path`, migration 0034). Call this only for an object
 * you have just made yourself (the cleanup after a failed insert), or for the path a
 * row-delete returned through `removePublicationDocumentAndObject`, which refuses to
 * return a path anything else still references. Deleting by a path you merely read
 * from somewhere is how a draft's "remove" once deleted the file a live version was
 * serving.
 */
export async function deleteDocumentObject(objectPath: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(DOCUMENT_BUCKET).remove([objectPath]);
}

/** The stored file a row points at is gone. Distinct from any other copy failure. */
export class DocumentObjectMissingError extends Error {
  constructor(readonly objectPath: string) {
    super(`The stored file ${objectPath} is missing.`);
    this.name = "DocumentObjectMissingError";
  }
}

/**
 * Copy an object to a NEW server-generated path inside the version that will own it,
 * and return that path. Server-side: no bytes pass through the application.
 *
 * This is what makes a publication version a genuinely frozen snapshot. A draft started
 * from a version gets its own copy of every file, so nothing done to the draft's
 * documents can reach the file a live version is serving.
 */
export async function copyDocumentObject(
  sourcePath: string, newVersionId: string, mimeType: string | null,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const target = newObjectPath(newVersionId, mimeType ?? "");
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).copy(sourcePath, target);
  if (error) {
    const status = String((error as { statusCode?: string | number }).statusCode ?? "");
    if (status === "404" || /not.?found|does not exist/i.test(error.message)) {
      throw new DocumentObjectMissingError(sourcePath);
    }
    throw new Error(`Could not copy the stored file: ${error.message}`);
  }
  return target;
}

/** What the data layer needs from the store when it copies or discards document files. */
export interface DocumentObjectStore {
  copy(sourcePath: string, newVersionId: string, mimeType: string | null): Promise<string>;
  remove(paths: string[]): Promise<void>;
}

export const documentObjectStore: DocumentObjectStore = {
  copy: copyDocumentObject,
  async remove(paths) {
    if (paths.length === 0) return;
    const admin = createSupabaseAdminClient();
    await admin.storage.from(DOCUMENT_BUCKET).remove(paths);
  },
};
