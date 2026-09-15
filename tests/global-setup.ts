// ============================================================================
// Integration-suite global setup: reset the DEDICATED TEST DATABASE.
// ----------------------------------------------------------------------------
// This drops every application table and reseeds. It used to do that to
// whatever DATABASE_URL pointed at, which meant `npm test` with a development
// or production connection string in .env.local would destroy it. It now runs
// only against TEST_DATABASE_URL, only in a test runtime, only with an explicit
// opt-in, and only if the database itself says it is disposable.
//
// There is no fallback to DATABASE_URL. If TEST_DATABASE_URL is absent this
// throws before a connection is opened. See src/lib/db/test-database.ts and
// docs/19-test-database-safety.md.
// ============================================================================
import { requireEnv } from "../scripts/env";
import { useTestDatabase, authorizeReset, describeTestDatabase } from "./test-database-env";
import { closePool } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/reset";

export default async function setup(): Promise<void> {
  // Refuses here — before requireEnv(), before any pool exists — if this is not
  // an approved disposable test database.
  const target = useTestDatabase("reset");

  requireEnv();

  // The remaining condition: the database's own disposability marker. This is
  // the only statement issued before the reset, and it is a read.
  const authorization = await authorizeReset();

  console.log(`[tests] resetting DEDICATED TEST database ${describeTestDatabase(target)}`);
  const applied = await resetDatabase(authorization);
  console.log(`[tests] applied ${applied.length} migration(s), seeded demonstration data`);
  await closePool();
}
