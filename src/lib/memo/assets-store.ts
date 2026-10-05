// ============================================================================
// Private store for frozen memo assets - Supabase Storage bucket `memo-assets`.
// ----------------------------------------------------------------------------
// Built like photos/storage.ts, for the same reasons: the bucket is PRIVATE, no
// public URL is ever minted, a byte leaves only as a sixty-second signed URL created
// server-side after the database has agreed this caller may read this memo, and an
// object path is server-generated and never reaches a browser.
//
// There is no update and no delete here, by design: a frozen asset is written once.
//
// SERVER-ONLY: it uses the secret key.
// ============================================================================
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  MEMO_ASSET_BUCKET, MEMO_ASSET_MAX_BYTES, MEMO_ASSET_SIGNED_URL_TTL_SECONDS, MEMO_ASSET_TYPE,
} from "@/lib/memo/assets";

/** Create the private bucket if absent. Idempotent; never flips an existing bucket to public. */
export async function ensureMemoAssetBucket(): Promise<{ created: boolean; isPublic: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.storage.getBucket(MEMO_ASSET_BUCKET);
  if (existing) return { created: false, isPublic: Boolean(existing.public) };
  const { error } = await admin.storage.createBucket(MEMO_ASSET_BUCKET, {
    public: false,
    fileSizeLimit: MEMO_ASSET_MAX_BYTES,
    allowedMimeTypes: [MEMO_ASSET_TYPE],
  });
  // Two finalisations racing to create it is fine: the loser finds it there.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`Could not create the ${MEMO_ASSET_BUCKET} bucket: ${error.message}`);
  }
  return { created: !error, isPublic: false };
}

/**
 * Write a frozen asset. NEVER overwrites. A path that already exists is success:
 * paths are content-addressed, so what is there is these same bytes (a retry).
 */
export async function putMemoAsset(path: string, body: Uint8Array): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(MEMO_ASSET_BUCKET).upload(path, body, {
    contentType: MEMO_ASSET_TYPE, upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`Could not store the memo asset: ${error.message}`);
  }
}

/** A short-lived signed URL. The caller must already have established the right to read. */
export async function signMemoAsset(path: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(MEMO_ASSET_BUCKET).createSignedUrl(path, MEMO_ASSET_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
