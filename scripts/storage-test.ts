// Provision the private document bucket on the DEDICATED TEST Supabase project.
//   npm run db:storage:test
//
// A separate command from `npm run db:storage` on purpose. That one is the
// operator path: it provisions the bucket on whatever NEXT_PUBLIC_SUPABASE_URL
// names, which is how a real environment gets its bucket, and quietly changing
// what it targets would mean an operator who typed the command they have always
// typed got a different project than the one they meant. So the test path is a
// different command with a different name, and it refuses unless the dedicated
// test project is configured.
//
// The integration suite provisions this itself (tests/global-setup.ts), so this
// is for the case where somebody wants the bucket to exist without running the
// suite — a freshly created test project, or a Playwright run before the first
// `npm test`.
import { useTestEnvironment } from "../tests/test-environment";
import { requireEnv } from "./env";
import { ensureDocumentBucket, DOCUMENT_BUCKET } from "@/lib/documents/storage";

async function main(): Promise<void> {
  // Refuses here if this is not an approved, disposable test project. Nothing
  // below can reach the application's project: the Supabase client reads the
  // declaration this makes, not NEXT_PUBLIC_SUPABASE_URL.
  const { supabase } = useTestEnvironment("connect");
  requireEnv();

  const { created, isPublic } = await ensureDocumentBucket();
  console.log(
    created
      ? `Created private bucket ${DOCUMENT_BUCKET} on TEST project ${supabase.projectRef}.`
      : `Bucket ${DOCUMENT_BUCKET} already exists on TEST project ${supabase.projectRef}.`,
  );
  // A public bucket would hand out every document to anyone with a URL. It is a
  // hard failure here for the same reason it is in the operator path.
  if (isPublic) {
    throw new Error(
      `Bucket ${DOCUMENT_BUCKET} is PUBLIC on the test project. Make it private before using it.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
