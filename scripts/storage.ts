// Provision the private document bucket on the configured Supabase project.
// Idempotent — safe to run before every deployment.
//   npm run db:storage
import { requireEnv } from "./env";
import { ensureDocumentBucket, DOCUMENT_BUCKET } from "@/lib/documents/storage";

async function main(): Promise<void> {
  requireEnv();
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
  const { created, isPublic } = await ensureDocumentBucket();
  console.log(
    created
      ? `Created private bucket ${DOCUMENT_BUCKET} on ${project}.`
      : `Bucket ${DOCUMENT_BUCKET} already exists on ${project}.`,
  );
  // A public bucket would hand out every investor document to anyone with a
  // URL, so this is a hard failure rather than a warning.
  if (isPublic) {
    throw new Error(
      `Bucket ${DOCUMENT_BUCKET} is PUBLIC. Investor documents must not be publicly readable — ` +
      `set it to private in the Supabase dashboard and rotate any object that may have been exposed.`,
    );
  }
  console.log("Bucket is private. Downloads are served only as short-lived signed URLs.");
}

main().catch((e) => {
  console.error(`Storage provisioning failed: ${(e as Error).message}`);
  process.exitCode = 1;
});
