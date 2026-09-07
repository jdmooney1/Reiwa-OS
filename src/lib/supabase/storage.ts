// ============================================================================
// Secure document delivery (P6) — private Storage, server-signed access.
// ----------------------------------------------------------------------------
// SERVER-ONLY. Uses the Supabase secret key, which must never reach a browser.
//
// The bucket is private, and no policy grants `anon` or `authenticated` any
// access to it: nothing can be fetched from Storage by an investor's own
// credentials at all. The only route to a document's bytes is a signed URL,
// minted here, and only after the caller has already been authorised against
// the P1 entitlement model by the database (see resolveDocumentDownload).
//
// A signed URL is therefore a *result* of authorisation, never a substitute
// for it: it is created after the check, expires in a minute, and confers no
// standing access — a revoked entitlement simply means the next request is
// refused and no new URL is ever produced.
// ============================================================================
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const DOCUMENT_BUCKET = "publication-documents";

/**
 * How long a download link stays valid.
 *
 * The link is minted in response to a click and used immediately, so it needs
 * to survive a redirect and a download start — not a browsing session. Sixty
 * seconds is enough for that and short enough that a link copied out of
 * history, a proxy log or a shared screen is dead before it is useful.
 */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Documents an investor may be shown. Bytes are capped at the bucket. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/png",
  "image/jpeg",
];

/**
 * Create the private bucket if it is missing, and assert it is private if it
 * already exists. Idempotent: safe to run on every deploy.
 */
export async function ensureDocumentBucket(): Promise<{ created: boolean; isPublic: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.storage.getBucket(DOCUMENT_BUCKET);

  if (existing) {
    if (existing.public) {
      // Never leave a public bucket holding investor documents.
      await admin.storage.updateBucket(DOCUMENT_BUCKET, { public: false });
      return { created: false, isPublic: false };
    }
    return { created: false, isPublic: false };
  }

  const { error } = await admin.storage.createBucket(DOCUMENT_BUCKET, {
    public: false,
    fileSizeLimit: MAX_DOCUMENT_BYTES,
    allowedMimeTypes: ALLOWED_DOCUMENT_MIME,
  });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Could not create the document bucket: ${error.message}`);
  }
  return { created: !error, isPublic: false };
}

/**
 * A short-lived download URL for one object path.
 *
 * CALL ONLY AFTER AUTHORISATION. This function does not know who is asking and
 * deliberately makes no access decision — passing an arbitrary path here would
 * sign it, which is why the single caller resolves the path through the
 * investor's own row level security first.
 */
export async function createSignedDocumentUrl(
  storagePath: string, opts: { downloadAs?: string | null } = {},
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS,
      opts.downloadAs ? { download: opts.downloadAs } : undefined);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Upload (or replace) a document's bytes. Admin path only. */
export async function uploadDocumentObject(
  storagePath: string, body: ArrayBuffer, contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDocumentBucket();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, body, { contentType, upsert: true });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Remove a document's bytes. Used when an admin deletes the document row. */
export async function removeDocumentObject(storagePath: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
}

/** Whether an object actually exists — so the UI can say so honestly. */
export async function documentObjectExists(storagePath: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const slash = storagePath.lastIndexOf("/");
  const dir = slash > 0 ? storagePath.slice(0, slash) : "";
  const name = slash > 0 ? storagePath.slice(slash + 1) : storagePath;
  const { data, error } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .list(dir, { search: name, limit: 100 });
  if (error || !data) return false;
  return data.some((o) => o.name === name);
}
