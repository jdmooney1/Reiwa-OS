// ============================================================================
// Private photo store - Supabase Storage bucket `property-photos`.
// ----------------------------------------------------------------------------
// Built exactly like documents/storage.ts, and for the same reasons:
//   * The bucket is PRIVATE. No public URL is ever minted. A byte leaves only as
//     a signed URL created server-side for sixty seconds, after the database has
//     agreed this caller may read this photograph (see ./delivery.ts).
//   * An object path is SERVER-GENERATED and random. A browser never supplies
//     one; the path of an existing photo is read back from `property_photos`.
//   * Content is validated before it is stored (./constraints).
//
// SERVER-ONLY: it uses the secret key and must never reach a client component.
// ============================================================================
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  PHOTO_BUCKET, PHOTO_SIGNED_URL_TTL_SECONDS, MAX_PHOTO_BYTES, ALLOWED_PHOTO_TYPES, thumbPathFor,
} from "@/lib/photos/constraints";

// Pure, so it lives in constraints.ts where a test can reach it without the
// Supabase client; re-exported here because this is where callers look.
export { thumbPathFor };

/** A fresh, unguessable path. The property id is a folder for legibility only. */
export function newPhotoObjectPath(propertyId: string, mimeType: string): string {
  const extension = ALLOWED_PHOTO_TYPES[mimeType] ?? "";
  return `properties/${propertyId}/${randomUUID()}${extension}`;
}

/**
 * Create the private bucket if absent. Idempotent, and it never flips an
 * existing bucket to public: if somebody has, that is reported, because objects
 * may already have been exposed.
 */
export async function ensurePhotoBucket(): Promise<{ created: boolean; isPublic: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.storage.getBucket(PHOTO_BUCKET);
  if (existing) return { created: false, isPublic: Boolean(existing.public) };

  const { error } = await admin.storage.createBucket(PHOTO_BUCKET, {
    public: false,
    fileSizeLimit: MAX_PHOTO_BYTES,
    allowedMimeTypes: Object.keys(ALLOWED_PHOTO_TYPES),
  });
  if (error) throw new Error(`Could not create the ${PHOTO_BUCKET} bucket: ${error.message}`);
  return { created: true, isPublic: false };
}

/** Store an object at a server-generated path. Never overwrites. */
export async function putPhotoObject(
  objectPath: string, body: ArrayBuffer | Uint8Array, mimeType: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(objectPath, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Could not store the photograph: ${error.message}`);
}

/**
 * Mint a short-lived signed URL. Callers must already have established that the
 * requester may read the photo: this does no authorisation of its own, and the
 * only request path that reaches it goes through ./delivery.ts.
 */
export async function signPhotoObject(objectPath: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(objectPath, PHOTO_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Remove a photograph's objects - the full image AND its thumbnail - so a
 * deleted photograph leaves nothing behind in the store. Removing a path that
 * does not exist is not an error, so this is safe for an upload that failed
 * half way and for a photograph stored before thumbnails existed.
 */
export async function deletePhotoObject(objectPath: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(PHOTO_BUCKET).remove([objectPath, thumbPathFor(objectPath)]);
}
