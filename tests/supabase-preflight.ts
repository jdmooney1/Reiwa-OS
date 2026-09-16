// ============================================================================
// The last check before the first Auth user is created.
// ----------------------------------------------------------------------------
// src/lib/db/test-supabase.ts proves, offline, that the four test variables all
// describe one project and that it is not the application's. What it cannot
// prove offline is that the SECRET KEY is really that project's: a modern
// sb_secret_ key is an opaque string with no project ref in it.
//
// That is not a safety hole — a key is only ever sent to the URL declared beside
// it, so a misplaced key is rejected by the test project rather than accepted by
// the project it came from. But it is a diagnosis problem. Without this, a wrong
// key surfaces as an authorisation error somewhere in the middle of seeding,
// after the database has already been dropped, and it reads like a Supabase
// outage rather than a configuration mistake.
//
// So: one read, against the declared test project, before anything is created.
// listUsers is the cheapest call that requires the service role, which is
// exactly the privilege about to be used.
// ============================================================================
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TestSupabaseProject } from "@/lib/db/test-supabase";

/**
 * Confirm the declared test project answers to its own secret key.
 *
 * Read-only: it lists a single user and discards the result. Throws with the
 * project ref and the variable names — never the key — when it does not.
 */
export async function assertSupabaseProjectReachable(
  project: TestSupabaseProject,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (!error) return;

  throw new Error(
    [
      "Refusing to run against Supabase: the dedicated test project did not " +
      "accept its own secret key.",
      "",
      `  Project: ${project.projectRef} (TEST_SUPABASE_URL)`,
      `  Supabase said: ${error.message}`,
      "",
      "TEST_SUPABASE_SECRET_KEY must be the secret key of that same project.",
      "Nothing was created, and no request was made to the application's project.",
      "See docs/19-test-database-safety.md.",
    ].join("\n"),
  );
}
