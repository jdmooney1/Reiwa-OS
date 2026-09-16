// ============================================================================
// Integration-suite global setup: reset the DEDICATED TEST ENVIRONMENT.
// ----------------------------------------------------------------------------
// This drops every application table and reseeds. It used to do that to whatever
// DATABASE_URL pointed at, which meant `npm test` with a development or
// production connection string in .env.local would destroy it. It now runs only
// against TEST_DATABASE_URL, only in a test runtime, only with an explicit
// opt-in, and only if the database itself says it is disposable.
//
// Seeding is not only a database operation. It creates Supabase Auth users for
// the staff accounts and for every seeded investor contact, and the suite that
// follows uploads real bytes into a Storage bucket. Those went to the
// APPLICATION's Supabase project until the environment gate covered both halves
// — so the arming call below is what stops a gated, correct-looking test run
// from creating accounts and objects in reiwa-dev.
//
// There is no fallback to DATABASE_URL and none to NEXT_PUBLIC_SUPABASE_URL or
// SUPABASE_SECRET_KEY. If any of the four test variables is absent this throws
// before a connection is opened. See src/lib/db/test-database.ts,
// src/lib/db/test-supabase.ts and docs/19-test-database-safety.md.
// ============================================================================
import { requireEnv } from "../scripts/env";
import { useTestEnvironment, authorizeReset, describeTestDatabase } from "./test-environment";
import { closePool } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/reset";
import { assertSupabaseProjectReachable } from "./supabase-preflight";
import { ensureDocumentBucket } from "@/lib/documents/storage";

export default async function setup(): Promise<void> {
  // Refuses here — before requireEnv(), before any pool exists, before any
  // Supabase client exists — if this is not an approved disposable test database
  // AND an approved disposable test Supabase project.
  const { databaseUrl, supabase } = useTestEnvironment("reset");

  requireEnv();

  // The remaining database condition: its own disposability marker. This is the
  // only statement issued before the reset, and it is a read.
  const authorization = await authorizeReset();

  // The remaining Supabase condition, and the last thing checked before the
  // first Auth user is created: that the secret key actually authenticates
  // against the TEST project. A key belonging to somewhere else fails here, as a
  // named refusal, rather than half way through seeding.
  await assertSupabaseProjectReachable(supabase);

  console.log(
    `[tests] resetting DEDICATED TEST database ${describeTestDatabase(databaseUrl)}`);
  console.log(
    `[tests] Auth and Storage target DEDICATED TEST project ${supabase.projectRef}`);

  const applied = await resetDatabase(authorization);

  // The seeder writes document rows that point at Storage objects, and
  // tests/document-delivery.test.ts uploads real bytes. A freshly created test
  // project has no bucket, so provision it here — inside the gate, against the
  // declared test project, never as a side effect of an operator command.
  const bucket = await ensureDocumentBucket();

  console.log(
    `[tests] applied ${applied.length} migration(s), seeded demonstration data, ` +
    `${bucket.created ? "created" : "reused"} the document bucket`);
  await closePool();
}
