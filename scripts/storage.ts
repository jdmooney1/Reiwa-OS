// Provision the private document bucket. Idempotent; safe on every deploy.
//
//   npx tsx scripts/storage.ts
//
// Creates `publication-documents` as a PRIVATE bucket if it is missing, and
// forces it private if it somehow exists as public. No Storage policy grants
// anon or authenticated any access: every download is a short-lived signed URL
// minted server-side after the P1 entitlement check.
import "./env";
import { requireEnv } from "./env";
import { installFailureHandlers, reportFailure } from "./fail";
import { ensureDocumentBucket, DOCUMENT_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";

installFailureHandlers("Storage setup");

async function main(): Promise<void> {
  requireEnv();
  const result = await ensureDocumentBucket();
  console.log(
    `[storage] bucket "${DOCUMENT_BUCKET}" ${result.created ? "created" : "already present"} — ` +
    `public: ${result.isPublic}; signed URL lifetime: ${SIGNED_URL_TTL_SECONDS}s`);
}

main().catch((e) => { reportFailure("Storage setup", e); process.exit(1); });
