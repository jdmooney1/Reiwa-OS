// ============================================================================
// Destructive reset of the application schema — development and tests only.
// ----------------------------------------------------------------------------
// Drops every object the migrations own (application tables in `public` plus the
// private `app` schema) and rebuilds them. Supabase Auth users are deliberately
// left in place: seedIdentities() reuses them by email, so a reset does not churn
// the Auth project.
//
// resetDatabase() cannot be called without an AUTHORISATION. That is not
// ceremony: the previous signature was `resetDatabase()`, so any code that
// could import this module could destroy whatever DATABASE_URL happened to
// point at, and the test harness did exactly that. An authorisation can only be
// minted by one of the two paths below, each of which has to establish its own
// right to destroy the target first.
//
//   * authorizeTestDatabaseReset()  — the automated suites. Requires a test
//     runtime, TEST_DATABASE_URL, an explicit opt-in, a database that is not
//     the application's, and a database that says it is disposable.
//     See ./test-database.ts.
//   * authorizeOperatorReset()      — `npm run db:reset -- --yes`. The
//     confirmation is necessary and not sufficient: the target database must
//     also carry `app.destructive_reset_allowed = 'true'`. A person can be
//     certain and still be pointed at the wrong database.
//
// The brand is a module-private symbol, so an authorisation cannot be written
// as an object literal by a caller in a hurry.
// ============================================================================
import type { Pool } from "pg";
import { getPool, runMigrations, probeDatabaseSettings } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { assertDisposableTestDatabase, type EnvSource } from "@/lib/db/test-database";
import { assertTargetIsDisposable, type SettingsReader } from "@/lib/db/destructive-reset";

const AUTHORISED = Symbol("reiwa.destructive-reset.authorised");

/** Proof that something has established the right to destroy a database. */
export interface ResetAuthorization {
  readonly [AUTHORISED]: true;
  /** Which path granted it — carried into the log line, never into a decision. */
  readonly grantedBy: "test-database-gate" | "operator";
  /** The database it was granted for, without its password. */
  readonly target: string;
}

/**
 * Read markers from the target database itself.
 *
 * A single `SELECT` on a short-lived connection to the database about to be
 * destroyed. It never borrows the application pool, which is bound to
 * DATABASE_URL — asking the wrong database whether the right one is disposable
 * would be worse than not asking at all.
 */
const readSettings: SettingsReader = (connectionString, settings) =>
  probeDatabaseSettings(connectionString, settings);

/**
 * Authorise a reset of the dedicated test database, or throw.
 *
 * Every condition is checked before this returns, and the only statement it
 * issues is the marker read.
 */
export async function authorizeTestDatabaseReset(
  env: EnvSource = process.env,
  settingsReader: SettingsReader = readSettings,
): Promise<ResetAuthorization> {
  const url = await assertDisposableTestDatabase(env, settingsReader);
  return { [AUTHORISED]: true, grantedBy: "test-database-gate", target: url };
}

/**
 * Authorise a reset a person has asked for at the command line.
 *
 * `--yes` is necessary and NOT sufficient. It records that somebody meant to
 * type the command; it says nothing about which database the command is
 * pointed at, and the case that matters is precisely the one where the operator
 * is certain and wrong — a stale DATABASE_URL, a shell that still has last
 * week's export in it, a terminal that is not the one they think it is.
 *
 * So the database has to agree, on its own account, that it may be destroyed:
 * `app.destructive_reset_allowed = 'true'`. Nothing else is accepted as
 * evidence — not the database or project name, not the hostname, not the word
 * "development", and not localhost. `reiwa-dev` on localhost is exactly the
 * shape of database that turns out to matter.
 */
export async function authorizeOperatorReset(
  confirmed: boolean,
  connectionString: string,
  settingsReader: SettingsReader = readSettings,
): Promise<ResetAuthorization> {
  if (!confirmed) {
    throw new Error("Refusing destructive reset: no operator confirmation was given.");
  }
  await assertTargetIsDisposable(connectionString, settingsReader);
  return { [AUTHORISED]: true, grantedBy: "operator", target: connectionString };
}

function assertAuthorised(authorization: ResetAuthorization): void {
  if (!authorization || authorization[AUTHORISED] !== true) {
    throw new Error(
      "Refusing destructive reset: no valid authorization was supplied. Mint one " +
      "with authorizeTestDatabaseReset() or authorizeOperatorReset().");
  }
}

/** Application tables in dependency order (children first). */
const TABLES = [
  // Investor access (P3)
  "investor_invites",
  // Investment Portal (P1)
  "investor_activity_events",
  "investor_requests",
  "investor_saved",
  "publication_entitlements",
  "publication_documents",
  "publication_version_sources",
  "publication_versions",
  "publication_sources",
  "investor_publications",
  "investor_contacts",
  "investor_organizations",
  // Opportunity foundation (Phase 1A)
  "ic_decision_amendments",
  "ic_decisions",
  "opportunity_risks",
  "opportunity_dd_items",
  "opportunity_documents",
  // Internal Reiwa OS
  "valuations",
  "asset_decisions",
  "asset_risks",
  "performance_periods",
  "business_plans",
  "assets",
  "transactions",
  "investment_cases",
  "opportunities",
  "properties",
  "portfolios",
  "organization_members",
  "profiles",
  "organizations",
  "fx_rates",
];

/**
 * Drop every migration-owned object. Nothing outside `public`/`app` is touched.
 *
 * Order matters, and not for correctness — `cascade` makes any order correct —
 * but for how long it takes against a real pooler.
 *
 * The original version dropped the 27 tables first and `app` last. Every one of
 * those drops had to re-resolve the triggers and RLS policies that referenced
 * `app`'s functions, and each was a separate round trip through the transaction
 * pooler. On a hosted database that added up until the teardown was flirting
 * with the pooler's statement timeout.
 *
 * Dropping `app` FIRST removes the helper functions, and cascade takes the
 * triggers and policies that depend on them with it — so by the time the tables
 * are dropped there is almost nothing left hanging off them. The tables then go
 * in ONE statement rather than 27, which is one round trip rather than 27 and
 * lets PostgreSQL take its locks in a single pass.
 *
 * An explicit, generous statement_timeout is set for the transaction. It is not
 * an attempt to escape the pooler's limit — it bounds this deliberately heavy
 * DDL so a teardown that genuinely hangs fails with a clear error instead of
 * being cut off somewhere unpredictable.
 *
 * UNAUTHORISED PRIMITIVE. This takes no authorisation because it takes the pool
 * it is told to, and the resilience tests drive it with a fake one. Production
 * code reaches it only through resetDatabase(), which is where the gate is. Do
 * not call it from anywhere else.
 */
export async function dropSchema(pool: Pool = getPool()): Promise<void> {
  const client = await pool.connect();
  const qualified = TABLES.map((t) => `public.${t}`).join(", ");
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '120s'");
    // First: the helpers, and with them every trigger and policy that used one.
    await client.query("drop schema if exists app cascade");
    await client.query("drop view if exists public.investor_feed cascade");
    // Then the tables, in a single statement.
    await client.query(`drop table if exists ${qualified} cascade`);
    await client.query("commit");
  } catch (e) {
    try { await client.query("rollback"); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Drop, migrate, seed. Returns the migrations that were applied.
 *
 * The authorisation is checked before the first statement, so a caller without
 * one fails having changed nothing.
 */
export async function resetDatabase(
  authorization: ResetAuthorization, pool: Pool = getPool(),
): Promise<string[]> {
  assertAuthorised(authorization);
  await dropSchema(pool);
  const applied = await runMigrations(pool);
  await seedIfEmpty(pool);
  return applied;
}
