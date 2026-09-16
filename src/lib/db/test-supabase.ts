// ============================================================================
// The Supabase-project isolation gate.
// ----------------------------------------------------------------------------
// Its sibling, ./test-database.ts, made the Postgres side safe: the integration
// suite drops every application table, and it now does that only to
// TEST_DATABASE_URL, only when the database itself says it is disposable.
//
// That left half the blast radius uncovered, and the wrong half to leave
// uncovered quietly. A Supabase project is not only a database. The suites also:
//
//   * create Supabase Auth users (the seeded staff accounts, the seeded
//     investor contacts, the E2E fixture investor);
//   * delete Supabase Auth users;
//   * create a Storage bucket, and upload and delete objects in it
//     (tests/document-delivery.test.ts really does put bytes in a bucket).
//
// All of that went through NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY —
// the APPLICATION's project. So a correctly-configured, fully-gated run could
// reset a disposable test Postgres while creating and deleting Auth users and
// Storage objects in reiwa-dev. The Postgres gate would report success. Nothing
// would look wrong until somebody noticed accounts they did not create, or a
// document that had been removed.
//
// Auth and Storage therefore get their own dedicated credentials, with the same
// rule the database side has: NO FALLBACK. If TEST_SUPABASE_URL,
// TEST_SUPABASE_PUBLISHABLE_KEY or TEST_SUPABASE_SECRET_KEY is absent, the
// harness refuses before it creates an Auth user, deletes an Auth user,
// provisions Storage, or resets and seeds anything. It never quietly borrows the
// application's values, because "configured to reach a project" has never been
// authorisation to write to it.
//
// ---------------------------------------------------------------------------
// PROVING THEY ARE ALL THE SAME PROJECT
// ---------------------------------------------------------------------------
// Four variables now describe the test environment, and a mismatch between them
// is worse than any one of them being absent: seeding a test database while
// provisioning identities somewhere else produces a broken fixture AND writes to
// a project nobody meant to touch.
//
// A hosted Supabase project is identified by its PROJECT REF. It is the
// subdomain of the API URL and the suffix of the Postgres username, so those two
// can be compared exactly, offline, with no secret ever leaving this process:
//
//     TEST_SUPABASE_URL   https://<ref>.supabase.co
//     TEST_DATABASE_URL   postgresql://postgres.<ref>:...@...pooler...
//
// The keys are the honest part of the problem. A modern sb_publishable_* /
// sb_secret_* key is an opaque random string and carries no ref at all, so there
// is no offline check that can prove it belongs to the test project — and a
// check that cannot fail is worse than no check, because people trust it.
//
// What makes a stray key SAFE rather than merely unchecked is that a key is only
// ever sent to the URL declared beside it. src/lib/supabase/env.ts resolves the
// URL and the keys as one unit, so a key belonging to reiwa-dev, configured here
// by mistake, is sent to the TEST project's URL — where it is rejected. It is
// never sent to reiwa-dev, so it cannot write there. The URL is what selects the
// project, and the URL's ref is checked exactly.
//
// On top of that, everything that CAN be contradicted offline is:
//   * a legacy JWT key carries its ref as a claim, and it is compared;
//   * a test key identical to the corresponding application key is refused,
//     which is the mistake people actually make (copy the dev values over, then
//     change only the URL);
//   * a test project ref equal to the application project ref is refused, so
//     "point the test variables at reiwa-dev" cannot be spelled at all.
//
// And, as on the database side: NOTHING here infers safety from a project being
// NAMED test. A project called reiwa-test-restore could be a production restore.
// Names are a property of whoever typed them.
// ============================================================================
import {
  projectRefFromApiUrl, projectRefFromDatabaseUrl, projectRefFromKey, supabaseKeyFormat,
} from "@/lib/supabase/project-ref";
import type { SupabaseProjectCredentials } from "@/lib/supabase/env";

/** Any environment-shaped map: process.env, or one a test constructs. */
export type EnvSource = Record<string, string | undefined>;

/** The headline refusal. Deliberately identical for every reason. */
export const SUPABASE_REFUSAL =
  "Refusing to run against Supabase: the dedicated test project is not configured.";

/** The three variables that describe the test project's HTTP API. */
export const TEST_SUPABASE_URL = "TEST_SUPABASE_URL";
export const TEST_SUPABASE_PUBLISHABLE_KEY = "TEST_SUPABASE_PUBLISHABLE_KEY";
export const TEST_SUPABASE_SECRET_KEY = "TEST_SUPABASE_SECRET_KEY";

/** Their application counterparts, which a test must never use. */
export const APPLICATION_COUNTERPART: Record<string, string> = {
  [TEST_SUPABASE_URL]: "NEXT_PUBLIC_SUPABASE_URL",
  [TEST_SUPABASE_PUBLISHABLE_KEY]: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  [TEST_SUPABASE_SECRET_KEY]: "SUPABASE_SECRET_KEY",
};

const PROVISIONING_HELP = [
  "The automated suites create Auth users and Storage objects. They must do that",
  "in a SEPARATE, disposable Supabase project — never reiwa-dev, staging or",
  "production — so the test project needs its own API credentials:",
  "",
  `  ${TEST_SUPABASE_URL}=https://<test-project-ref>.supabase.co`,
  `  ${TEST_SUPABASE_PUBLISHABLE_KEY}=<the TEST project's publishable key>`,
  `  ${TEST_SUPABASE_SECRET_KEY}=<the TEST project's secret key>`,
  "",
  "All three must belong to the SAME project as TEST_DATABASE_URL. Leave",
  "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and",
  "SUPABASE_SECRET_KEY pointing at your development project: the harness never",
  "reads them and never falls back to them.",
  "",
  "See docs/19-test-database-safety.md.",
].join("\n");

/** A refusal carrying the headline message and the specific reason. */
export class TestSupabaseRefusal extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super([SUPABASE_REFUSAL, "", `  Reason: ${reason}`, "", PROVISIONING_HELP].join("\n"));
    this.name = "TestSupabaseRefusal";
    this.reason = reason;
  }
}

/** The approved test project: credentials plus the ref they were proved against. */
export interface TestSupabaseProject extends SupabaseProjectCredentials {
  /** The project ref every one of the four test variables agrees on. */
  projectRef: string;
}

function value(env: EnvSource, name: string): string {
  return (env[name] ?? "").trim();
}

/**
 * The whole gate. Pure — no I/O, no connection, no Supabase call.
 *
 * Returns the approved credentials. Throws `TestSupabaseRefusal` for every
 * failure, so a caller cannot mistake a refusal for a falsy result. No secret
 * appears in any message: refusals name variables and project refs, both of
 * which are safe to print.
 */
export function checkTestSupabaseEnv(env: EnvSource): TestSupabaseProject {
  // 1. Present, with no fallback to the application's own values.
  for (const name of [TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY, TEST_SUPABASE_SECRET_KEY]) {
    if (value(env, name) === "") {
      throw new TestSupabaseRefusal(
        `${name} is not set. The harness never falls back to ` +
        `${APPLICATION_COUNTERPART[name]}: being configured to reach the ` +
        "application's Supabase project is not authorisation to create Auth " +
        "users or Storage objects in it.");
    }
  }

  const url = value(env, TEST_SUPABASE_URL);
  const publishableKey = value(env, TEST_SUPABASE_PUBLISHABLE_KEY);
  const secretKey = value(env, TEST_SUPABASE_SECRET_KEY);

  // 2. Never the application's own credentials under a test name. This is the
  //    mistake people actually make: copy the dev block, rename the keys.
  for (const [name, provided] of [
    [TEST_SUPABASE_URL, url],
    [TEST_SUPABASE_PUBLISHABLE_KEY, publishableKey],
    [TEST_SUPABASE_SECRET_KEY, secretKey],
  ] as const) {
    const counterpart = APPLICATION_COUNTERPART[name];
    const applicationValue = value(env, counterpart);
    if (applicationValue !== "" && applicationValue === provided) {
      throw new TestSupabaseRefusal(
        `${name} is identical to ${counterpart}. The test project must be a ` +
        "separate, disposable Supabase project.");
    }
  }

  // 3. A hosted Supabase project URL, from which the ref is read.
  const projectRef = projectRefFromApiUrl(url);
  if (!projectRef) {
    throw new TestSupabaseRefusal(
      `${TEST_SUPABASE_URL} is not a hosted Supabase project URL of the form ` +
      "https://<project-ref>.supabase.co, so the project it names cannot be " +
      "established.");
  }

  // 4. Not the application's project, however it was spelled. Comparing refs
  //    rather than whole URLs catches a trailing slash, a different scheme and
  //    a stray port all at once.
  const applicationRef = projectRefFromApiUrl(value(env, "NEXT_PUBLIC_SUPABASE_URL"));
  if (applicationRef && applicationRef === projectRef) {
    throw new TestSupabaseRefusal(
      `${TEST_SUPABASE_URL} names project "${projectRef}", which is the same ` +
      "project as NEXT_PUBLIC_SUPABASE_URL. Automated tests must never create " +
      "Auth users or Storage objects in the application's project.");
  }

  // 5. The same project as the test DATABASE. A run that seeds one project's
  //    Postgres while provisioning identities in another produces a fixture that
  //    cannot work, and writes to a project nobody chose.
  const testDatabaseUrl = value(env, "TEST_DATABASE_URL");
  if (testDatabaseUrl === "") {
    throw new TestSupabaseRefusal(
      "TEST_DATABASE_URL is not set, so there is nothing to prove " +
      `${TEST_SUPABASE_URL} is consistent with.`);
  }
  const databaseRef = projectRefFromDatabaseUrl(testDatabaseUrl);
  if (!databaseRef) {
    throw new TestSupabaseRefusal(
      "TEST_DATABASE_URL does not carry a Supabase project ref in its username " +
      "(expected postgresql://postgres.<project-ref>:...). Use the project's " +
      "pooler connection string, which is the one that identifies the project.");
  }
  if (databaseRef !== projectRef) {
    throw new TestSupabaseRefusal(
      `${TEST_SUPABASE_URL} names project "${projectRef}" but TEST_DATABASE_URL ` +
      `names project "${databaseRef}". All four test variables must describe one ` +
      "single dedicated test project.");
  }

  // 6. Recognisable keys. A placeholder, a pasted URL or a truncated value is
  //    caught here rather than as an opaque 401 in the middle of seeding.
  for (const [name, key, expected] of [
    [TEST_SUPABASE_PUBLISHABLE_KEY, publishableKey, "publishable"],
    [TEST_SUPABASE_SECRET_KEY, secretKey, "secret"],
  ] as const) {
    const format = supabaseKeyFormat(key);
    if (format === "unrecognised") {
      throw new TestSupabaseRefusal(
        `${name} is not a recognisable Supabase key (expected an ` +
        `sb_${expected}_ key or a legacy JWT).`);
    }
    // A secret key in the publishable slot is not a typo to be relaxed about: it
    // would put a service-role credential everywhere the anon key goes.
    if (format !== "legacy-jwt" && format !== expected) {
      throw new TestSupabaseRefusal(
        `${name} holds an sb_${format}_ key. The publishable and secret keys ` +
        "have been swapped.");
    }
    // 7. Where a ref IS derivable offline — a legacy JWT — a contradiction is
    //    free to catch, so catch it.
    const keyRef = projectRefFromKey(key);
    if (keyRef && keyRef !== projectRef) {
      throw new TestSupabaseRefusal(
        `${name} belongs to project "${keyRef}", not to "${projectRef}". All ` +
        "four test variables must describe one single dedicated test project.");
    }
  }

  if (publishableKey === secretKey) {
    throw new TestSupabaseRefusal(
      `${TEST_SUPABASE_PUBLISHABLE_KEY} and ${TEST_SUPABASE_SECRET_KEY} are the ` +
      "same value. They are different credentials with different privileges.");
  }

  return { url, publishableKey, secretKey, projectRef };
}
