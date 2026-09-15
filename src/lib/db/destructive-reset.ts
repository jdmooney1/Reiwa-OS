// ============================================================================
// Destructive-reset permission — a property of the database, not of its name.
// ----------------------------------------------------------------------------
// Two different questions get confused with each other, and the confusion is
// what destroys data:
//
//   CLASSIFICATION   what is this database for?      app.environment
//   PERMISSION       may this database be destroyed?  app.destructive_reset_allowed
//
// They are not the same question and one does not imply the other. A database
// can be classified `development` and still be the one a live-facing preview
// deployment reads from, still hold the only copy of a week of manual test
// setup, still be the thing somebody is demonstrating from in an hour. This
// module owns PERMISSION only; ./test-database.ts owns classification.
//
// The permission is a per-database setting, set once, deliberately:
//
//     ALTER DATABASE postgres SET app.destructive_reset_allowed = 'true';
//
// A per-database setting was chosen over a row in a table for one reason that
// decides it: the thing it guards drops the schema. A marker inside the schema
// would be destroyed by the first reset and could not guard the second. It also
// cannot be inherited by accident from a connection string, a checked-in file
// or an environment variable somebody exported months ago — it lives on the
// database and travels with it.
//
// NOTHING ELSE COUNTS AS EVIDENCE. Not the database name, not the project name,
// not the hostname, not the word "development" anywhere, not localhost, and not
// the operator having typed --yes. Every one of those is a statement about what
// somebody believes the database is; the marker is the database's own answer.
// `reiwa-dev` on localhost is exactly the shape of database that turns out to
// matter, which is why localhost alone is explicitly not sufficient.
// ============================================================================

/** The per-database setting that permits a destructive reset. */
export const DESTRUCTIVE_RESET_SETTING = "app.destructive_reset_allowed";

/** The only value that permits it. */
export const DESTRUCTIVE_RESET_ALLOWED = "true";

/** The refusal, identical whether the marker is absent, false or anything else. */
export const NOT_DISPOSABLE_REFUSAL =
  "Refusing destructive database reset: target database is not explicitly marked disposable.";

export class NotDisposableRefusal extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super([NOT_DISPOSABLE_REFUSAL, "", `  Reason: ${reason}`, "", MARKING_HELP].join("\n"));
    this.name = "NotDisposableRefusal";
    this.reason = reason;
  }
}

const MARKING_HELP = [
  "If this database really is disposable, mark it as its owner:",
  `    ALTER DATABASE <database> SET ${DESTRUCTIVE_RESET_SETTING} = '${DESTRUCTIVE_RESET_ALLOWED}';`,
  "then reconnect — the setting applies to sessions opened after it.",
  "",
  "Do NOT mark a database that is connected to any live-facing deployment or",
  "holds data anyone would miss. See docs/19-test-database-safety.md.",
].join("\n");

/**
 * Reads per-database settings in one round trip. Injected everywhere so the
 * gates are testable without a database.
 */
export type SettingsReader = (
  connectionString: string, settings: readonly string[],
) => Promise<Record<string, string | null>>;

/**
 * Assert that a database has given its own permission to be destroyed.
 *
 * Pure: it decides on a value that has already been read, so the reading and
 * the deciding can be tested separately and the decision has no way to reach a
 * database of its own.
 */
export function assertDestructiveResetAllowed(marker: string | null | undefined): void {
  if (marker === null || marker === undefined || marker.trim() === "") {
    throw new NotDisposableRefusal(
      `${DESTRUCTIVE_RESET_SETTING} is not set on the target database. An ` +
      "unmarked database is treated as one whose data matters.");
  }
  if (marker.trim() !== DESTRUCTIVE_RESET_ALLOWED) {
    throw new NotDisposableRefusal(
      `${DESTRUCTIVE_RESET_SETTING} is "${marker.trim()}", not ` +
      `"${DESTRUCTIVE_RESET_ALLOWED}".`);
  }
}

/**
 * Read the permission marker from a target database and decide.
 *
 * A failure to read is a refusal, not a pass: a database that cannot be asked
 * whether it may be destroyed has not said yes.
 */
export async function assertTargetIsDisposable(
  connectionString: string, readSettings: SettingsReader,
): Promise<void> {
  let settings: Record<string, string | null>;
  try {
    settings = await readSettings(connectionString, [DESTRUCTIVE_RESET_SETTING]);
  } catch (e) {
    throw new NotDisposableRefusal(
      "the database could not be asked whether it may be destroyed: " +
      `${(e as Error).message}`);
  }
  assertDestructiveResetAllowed(settings[DESTRUCTIVE_RESET_SETTING]);
}
