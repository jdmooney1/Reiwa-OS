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
import { seedDemoFixtures } from "@/lib/db/seed";
import { seedReiwaFixtures } from "@/lib/db/fixtures";

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
  // Internal Reiwa OS — deal file (0007)
  "decision_log",
  "deal_documents",
  "deal_contacts",
  "dd_items",
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

/** Drop every migration-owned object. Nothing outside `public`/`app` is touched. */
export async function dropSchema(pool: Pool = getPool()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("drop view if exists public.investor_feed cascade");
    for (const table of TABLES) {
      await client.query(`drop table if exists public.${table} cascade`);
    }
    await client.query("drop schema if exists app cascade");
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Which fixtures a freshly reset database is loaded with.
 *   "reiwa" — the firm's own four reference deals (the default).
 *   "demo"  — the fictional multi-tenant fixtures the integration tests need.
 */
export type FixtureSet = "reiwa" | "demo";

/** Seed a database that has no organisations yet. Returns true if it seeded. */
export async function seedIfEmpty(
  pool: Pool = getPool(), fixtures: FixtureSet = "reiwa",
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const existing = await client.query<{ n: number }>(
      "select count(*)::int as n from organizations");
    if ((existing.rows[0]?.n ?? 0) > 0) return false;
  } finally {
    client.release();
  }

  if (fixtures === "demo") return seedDemoFixtures(pool);
  await seedReiwaFixtures(pool);
  return true;
}

/** Drop, migrate, seed. Returns the migrations that were applied. */
export async function resetDatabase(
  pool: Pool = getPool(), fixtures: FixtureSet = "reiwa",
): Promise<string[]> {
  await dropSchema(pool);
  const applied = await runMigrations(pool);
  await seedIfEmpty(pool, fixtures);
  return applied;
}
