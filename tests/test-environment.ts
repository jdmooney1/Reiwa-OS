// ============================================================================
// Point this process at the dedicated test ENVIRONMENT — or refuse to run.
// ----------------------------------------------------------------------------
// A test environment is not a database. It is a database AND a Supabase project:
// the suites reset Postgres, and they also create Auth users, delete Auth users,
// create a Storage bucket and upload and delete objects in it.
//
// This module used to cover only the first of those (as tests/test-database-env
// .ts), which meant a run could be perfectly gated on the Postgres side while
// every Auth user and every Storage object it created landed in reiwa-dev. So
// the two halves are armed HERE, together, in one call. There is deliberately no
// way to arm one without the other: a caller cannot ask for an isolated database
// and accidentally get the application's Supabase project with it.
//
// Imported by the Vitest global setup (which resets), by the per-file setup that
// runs in every worker (which does not), and by the Playwright config (whose
// specs create Auth users from the runner process and drive a server that writes
// Storage objects).
//
// ---------------------------------------------------------------------------
// THE TWO HALVES ARE REDIRECTED DIFFERENTLY, AND THAT IS ON PURPOSE
// ---------------------------------------------------------------------------
// SUPABASE is DECLARED. src/lib/supabase/env.ts lets a process state which
// project it is talking to, and that is what happens here. The application's own
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY /
// SUPABASE_SECRET_KEY are left completely alone — they keep meaning the
// development project, in this process as everywhere else, which is what makes
// the gate's "is the test project the same as the application project?" check
// answerable at all.
//
// THE DATABASE is REDIRECTED, by overwriting DATABASE_URL in this process. Not
// because that is nicer, but because `createPool()` reads DATABASE_URL and the
// alternative is a "which database am I talking to?" branch threaded through the
// data layer — a branch that would exist in production code and could be taken
// in production. The overwrite has one consequence worth being explicit about:
// once DATABASE_URL has been replaced, comparing TEST_DATABASE_URL against it
// compares a value with itself, and every run would report "the test database is
// the application database". So the pre-redirect value is kept here and every
// later authorisation is decided against THAT — the connection string the
// application would really have used.
//
// Both gates run to completion BEFORE anything is mutated or declared, so a
// refusal leaves the process exactly as it found it.
// ============================================================================
import "../scripts/env";
import { checkTestDatabaseEnv, type TestDatabasePurpose } from "@/lib/db/test-database";
import { checkTestSupabaseEnv, type TestSupabaseProject } from "@/lib/db/test-supabase";
import { useSupabaseProject } from "@/lib/supabase/env";
import { authorizeTestDatabaseReset, type ResetAuthorization } from "@/lib/db/reset";

/** What an armed test environment consists of. */
export interface TestEnvironment {
  /** The approved test database connection string. */
  databaseUrl: string;
  /** The approved test Supabase project. */
  supabase: TestSupabaseProject;
}

let armed: TestEnvironment | null = null;
/** DATABASE_URL as it was before the redirect: the application's own database. */
let applicationDatabaseUrl: string | undefined;

/**
 * Arm the dedicated test environment: the disposable Postgres AND the disposable
 * Supabase project.
 *
 * @param purpose "reset" for the process that will actually reset; "connect" for
 *   one that only reads and writes rows against an already-seeded database.
 */
export function useTestEnvironment(purpose: TestDatabasePurpose): TestEnvironment {
  if (armed) return armed;

  // Both gates first. Neither mutates anything, so if either refuses, nothing in
  // this process has been changed and no client can have been built against a
  // half-applied configuration.
  const supabase = checkTestSupabaseEnv(process.env);
  const databaseUrl = checkTestDatabaseEnv(process.env, { purpose });

  // Supabase: declared, not overwritten.
  useSupabaseProject(
    { url: supabase.url, publishableKey: supabase.publishableKey, secretKey: supabase.secretKey },
    `the test harness (purpose: ${purpose})`,
  );

  // Database: redirected, with the application's own value preserved.
  applicationDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;

  armed = { databaseUrl, supabase };
  return armed;
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
