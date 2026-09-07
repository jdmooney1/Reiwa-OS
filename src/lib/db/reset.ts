// ============================================================================
// Destructive reset of the application schema — development and tests only.
// ----------------------------------------------------------------------------
// Drops every object the migrations own (application tables in `public` plus the
// private `app` schema) and rebuilds them. Supabase Auth users are deliberately
// left in place: seedIdentities() reuses them by email, so a reset does not churn
// the Auth project.
// ============================================================================
import type { Pool } from "pg";
import { getPool, runMigrations } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";

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

/** Drop, migrate, seed. Returns the migrations that were applied. */
export async function resetDatabase(pool: Pool = getPool()): Promise<string[]> {
  await dropSchema(pool);
  const applied = await runMigrations(pool);
  await seedIfEmpty(pool);
  return applied;
}
