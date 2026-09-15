// ============================================================================
// The destructive-reset safety gate.
// ----------------------------------------------------------------------------
// `resetDatabase()` drops every application table and the `app` schema. Until
// this module existed, the only thing standing between that and a development,
// staging or production Supabase project was which value happened to be in
// DATABASE_URL when somebody typed `npm test` — because the test harness read
// the ordinary application connection string and reset whatever it found.
//
// That is the wrong shape for a destructive operation. Being configured to talk
// to a database must never, on its own, authorise destroying it.
//
// So the test harness no longer reads DATABASE_URL at all. It reads
// TEST_DATABASE_URL, and there is NO fallback: absent, the integration suite
// stops before it opens a connection. On top of that, four independent
// conditions must all hold before a single statement is issued:
//
//   1. The process is an explicit test runtime (NODE_ENV === "test").
//   2. TEST_DATABASE_URL is set.
//   3. ALLOW_TEST_DATABASE_RESET is exactly "true" — a deliberate opt-in that
//      nothing sets for you.
//   4. TEST_DATABASE_URL is not the same database as any application
//      connection string this process can see, AND the database itself says it
//      is disposable.
//
// A caller that only CONNECTS to the test database — the Playwright suite, and
// each Vitest worker — passes `purpose: "connect"` and is held to conditions 2
// and 4 only. It must still be the dedicated test database and still must not be
// an application one; it is simply not asked for a destructive opt-in it has no
// use for. See TestDatabasePurpose.
//
// Conditions 1-3 and the URL comparison in 4 are pure: they are decided from an
// environment map with no I/O, which is why they can be tested without a
// database and why they cannot be reached round. Only the marker read in 4
// touches Postgres, and it is a single read of a setting — the refusal always
// happens before any DROP.
//
// WHY A DATABASE-LEVEL MARKER, NOT A HOSTNAME PATTERN. A name containing
// "test" is a naming convention, and naming conventions are a property of the
// person who typed the name rather than of the database. `reiwa-test-restore`
// might be a production restore. The marker is set once, deliberately, on the
// database itself:
//
//     ALTER DATABASE postgres SET app.environment = 'test';
//
// It is a per-database setting, so it survives `drop schema` — which matters,
// because the thing it guards drops the schema — and it cannot be inherited by
// accident from a connection string or a checked-in file. If it is missing, or
// is anything other than exactly "test", the reset is refused.
// ============================================================================

/** Any environment-shaped map: process.env, or one a test constructs. */
export type EnvSource = Record<string, string | undefined>;

/** The headline refusal. Deliberately identical for every reason. */
export const RESET_REFUSAL =
  "Refusing destructive test reset: TEST_DATABASE_URL is not an approved disposable test database.";

/** The per-database setting that marks a database as disposable. */
export const ENVIRONMENT_MARKER_SETTING = "app.environment";

/** The only value of that setting which permits a destructive reset. */
export const TEST_ENVIRONMENT_MARKER = "test";

/** The opt-in flag, and the only value that counts as set. */
export const RESET_OPT_IN = "ALLOW_TEST_DATABASE_RESET";

/**
 * Connection strings that name a database this harness must never destroy.
 *
 * DATABASE_URL is the application's own, and is the one that would actually
 * have been reset before this gate existed. The rest are listed because a
 * developer who keeps several environments side by side tends to keep them all
 * in one .env file, and a test database that happens to equal any of them is
 * not a test database.
 */
export const APPLICATION_DATABASE_ENV: readonly string[] = [
  "DATABASE_URL",
  "PRODUCTION_DATABASE_URL",
  "PROD_DATABASE_URL",
  "STAGING_DATABASE_URL",
  "DEV_DATABASE_URL",
  "DEVELOPMENT_DATABASE_URL",
];

/**
 * A connection string reduced to the database it names, with the password
 * removed: `user@host/database`.
 *
 * The USER is part of the identity and the PORT is not, both for the same
 * reason — this has to be right for hosted Supabase specifically. Every project
 * in a region shares the pooler hostname and the database name `postgres`; what
 * distinguishes them is the project ref, which lives in the username
 * (`postgres.<project-ref>`). Comparing on host and database alone would refuse
 * a perfectly good separate test project as though it were production.
 *
 * Dropping the port is the other half: the same database reached through the
 * transaction pooler (6543) and directly (5432) is the same database, and a
 * comparison that missed that would let the application's own database through
 * on the other port.
 */
export function databaseIdentity(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const user = decodeURIComponent(url.username).toLowerCase();
    const host = url.hostname.toLowerCase();
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
    return `${user}@${host}/${database}`;
  } catch {
    // Not a parseable URL. Compare it literally rather than treating an
    // unparseable string as matching nothing.
    return trimmed.toLowerCase();
  }
}

/** A refusal carrying the headline message and the specific reason. */
export class TestDatabaseRefusal extends Error {
  readonly reason: string;
  constructor(reason: string, remedy?: string) {
    super([RESET_REFUSAL, "", `  Reason: ${reason}`, ...(remedy ? ["", remedy] : [])].join("\n"));
    this.name = "TestDatabaseRefusal";
    this.reason = reason;
  }
}

const PROVISIONING_HELP = [
  "To authorise a destructive test run:",
  "  1. Create a SEPARATE, disposable Supabase project (never reiwa-dev,",
  "     staging or production).",
  "  2. Mark the database as disposable, connected as its owner:",
  `       ALTER DATABASE postgres SET ${ENVIRONMENT_MARKER_SETTING} = '${TEST_ENVIRONMENT_MARKER}';`,
  "     then reconnect, because the setting applies to new sessions.",
  "  3. Put its connection string in TEST_DATABASE_URL (not DATABASE_URL).",
  `  4. Set ${RESET_OPT_IN}=true for the run.`,
  "",
  "See docs/19-test-database-safety.md.",
].join("\n");

/**
 * What the caller is about to do.
 *
 *   "reset"   — drop, migrate and reseed. Every condition applies.
 *   "connect" — read and write rows against an already-seeded test database.
 *               Still must be the dedicated test database and still must not be
 *               an application one, but the destructive conditions do not apply:
 *               a Playwright run resets nothing, and demanding
 *               ALLOW_TEST_DATABASE_RESET for it would train everybody to
 *               export the destructive flag permanently, which is the habit
 *               this gate exists to prevent. NODE_ENV is likewise not required,
 *               because Playwright does not set it and there is nothing
 *               destructive here for it to guard.
 */
export type TestDatabasePurpose = "reset" | "connect";

export interface TestDatabaseCheckOptions {
  purpose?: TestDatabasePurpose;
}

/**
 * Conditions 1-3 and the URL comparison from 4. Pure — no I/O, no connection.
 *
 * Returns the approved connection string. Throws `TestDatabaseRefusal` for
 * every failure, so a caller cannot mistake a refusal for a falsy result.
 */
export function checkTestDatabaseEnv(
  env: EnvSource, options: TestDatabaseCheckOptions = {},
): string {
  const destructive = (options.purpose ?? "reset") === "reset";
  // 1. An explicit test runtime. Vitest sets NODE_ENV=test itself; nothing in
  //    the application or the deployment does.
  if (destructive && env.NODE_ENV !== "test") {
    throw new TestDatabaseRefusal(
      `NODE_ENV is ${env.NODE_ENV ? `"${env.NODE_ENV}"` : "unset"}, not "test". ` +
      "A destructive reset runs only inside an explicit test runtime.",
      PROVISIONING_HELP);
  }

  // 2. TEST_DATABASE_URL, with no fallback to DATABASE_URL. Being configured to
  //    reach a database is not authorisation to destroy it.
  const url = (env.TEST_DATABASE_URL ?? "").trim();
  if (!url) {
    throw new TestDatabaseRefusal(
      "TEST_DATABASE_URL is not set. The integration suite never falls back to " +
      "DATABASE_URL.",
      PROVISIONING_HELP);
  }

  // 3. A deliberate opt-in for this run.
  if (destructive && env[RESET_OPT_IN] !== "true") {
    throw new TestDatabaseRefusal(
      `${RESET_OPT_IN} is not "true". The reset drops every application table ` +
      "and must be asked for explicitly.",
      PROVISIONING_HELP);
  }

  // 4a. Never the same database as one the application itself uses.
  const target = databaseIdentity(url);
  for (const name of APPLICATION_DATABASE_ENV) {
    const configured = env[name];
    if (!configured || configured.trim() === "") continue;
    if (databaseIdentity(configured) === target) {
      throw new TestDatabaseRefusal(
        `TEST_DATABASE_URL names the same database as ${name} (${target}). ` +
        "A test database must be a separate, disposable database.",
        PROVISIONING_HELP);
    }
  }

  return url;
}

/** Reads a per-database setting. Injected so the gate is testable without one. */
export type MarkerReader = (connectionString: string) => Promise<string | null>;

/**
 * The whole gate: conditions 1-3, the URL comparison, then the marker.
 *
 * The order is the point. Everything that can be decided without touching
 * Postgres is decided first, so a misconfigured run is refused before it opens
 * a connection; the marker read is the last check and is a single `SELECT`.
 * No DROP, no migration and no truncation can be reached from here.
 */
export async function assertDisposableTestDatabase(
  env: EnvSource,
  readMarker: MarkerReader,
): Promise<string> {
  const url = checkTestDatabaseEnv(env);

  let marker: string | null;
  try {
    marker = await readMarker(url);
  } catch (e) {
    throw new TestDatabaseRefusal(
      `the database could not be asked whether it is disposable: ${(e as Error).message}`,
      PROVISIONING_HELP);
  }

  // 4b. The database's own answer, not a guess from its name.
  if (marker === null || marker.trim() === "") {
    throw new TestDatabaseRefusal(
      `${ENVIRONMENT_MARKER_SETTING} is not set on the target database. An ` +
      "unmarked database is treated as real data.",
      PROVISIONING_HELP);
  }
  if (marker.trim() !== TEST_ENVIRONMENT_MARKER) {
    throw new TestDatabaseRefusal(
      `${ENVIRONMENT_MARKER_SETTING} is "${marker.trim()}", not ` +
      `"${TEST_ENVIRONMENT_MARKER}".`,
      PROVISIONING_HELP);
  }

  return url;
}
