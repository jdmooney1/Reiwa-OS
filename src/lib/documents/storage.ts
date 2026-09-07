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
  checkUpload, type UploadCheck,
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
 * Remove an object. Used when its `publication_documents` row is deleted, so a
 * removed document leaves nothing behind in the store.
 */
export async function deleteDocumentObject(objectPath: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(DOCUMENT_BUCKET).remove([objectPath]);
}
