// ============================================================================
// Point this process at the dedicated test database — or refuse to run.
// ----------------------------------------------------------------------------
// Imported by the Vitest global setup (which resets) and by the per-file setup
// that runs in every worker (which does not). Both need the same thing: every
// pool opened in this process must reach TEST_DATABASE_URL and nothing else.
//
// The redirect is what makes that true. `createPool()` reads DATABASE_URL,
// because that is the only thing the application knows about; rather than
// thread a second connection string through the data layer — which would put a
// "which database am I talking to?" branch inside production code — the test
// bootstrap overwrites DATABASE_URL in its own process, AFTER the gate has
// established that the replacement is a disposable test database and is not the
// application's own.
//
// That overwrite has one consequence worth being explicit about, because
// getting it wrong would quietly weaken the gate: once DATABASE_URL has been
// replaced, comparing TEST_DATABASE_URL against DATABASE_URL compares a value
// with itself. It would always match, and "the test database is the application
// database" would be reported for every run — a gate that cries wolf is a gate
// somebody switches off. So the pre-redirect value is kept here, and every
// later authorisation is decided against THAT, which is the connection string
// the application would really have used.
// ============================================================================
import "../scripts/env";
import { checkTestDatabaseEnv, type TestDatabasePurpose } from "@/lib/db/test-database";
import { authorizeTestDatabaseReset, type ResetAuthorization } from "@/lib/db/reset";

let applied: string | null = null;
/** DATABASE_URL as it was before the redirect: the application's own database. */
let applicationDatabaseUrl: string | undefined;

/**
 * Redirect this process's DATABASE_URL to the approved test database.
 *
 * @param purpose "reset" for the process that will actually reset.
 * @returns the approved connection string.
 */
export function useTestDatabase(purpose: TestDatabasePurpose): string {
  if (applied) return applied;
  const url = checkTestDatabaseEnv(process.env, { purpose });
  applicationDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  applied = url;
  return url;
}

/**
 * Mint an authorisation for a destructive reset of the test database.
 *
 * Re-runs the whole gate — runtime, opt-in, URL comparison and the database's
 * own marker — against the application's real connection string rather than the
 * redirected one. Used by the global setup and by the one integration test that
 * resets deliberately.
 */
export function authorizeReset(): Promise<ResetAuthorization> {
  const env = { ...process.env, DATABASE_URL: applicationDatabaseUrl };
  return authorizeTestDatabaseReset(env);
}

/** The target, with its password removed, for a log line. */
export function describeTestDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.username}@${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}
