import type { Pool } from "pg";
import { adminQuery, getPool, type Session } from "@/lib/db/client";

/**
 * The shared integration database — the real Supabase Postgres configured in
 * .env.local. `tests/global-setup.ts` drops, migrates and seeds it once per run,
 * and vitest executes test files serially, so each file sees the seeded fixture
 * plus whatever earlier files committed.
 */
export function testPool(): Pool {
  return getPool();
}

// ---------------------------------------------------------------------------
// Test identities are REAL seeded profiles, not synthetic UUIDs.
//
// They used to be invented constants, which worked only because nothing wrote
// an author. The moment records started carrying created_by, every one of those
// sessions was a user who does not exist — and the workaround was to pass a
// null author, i.e. to record that nobody wrote it. On a system whose whole
// value is being able to say who decided what, a test suite that routinely
// produces unattributed records is not testing the system.
//
// tests/setup.ts loads these once per file, before any test runs, so the
// session builders below stay synchronous and no call site changes.
// ---------------------------------------------------------------------------
const SEED_EMAILS = {
  admin: "admin@reiwa.com",
  analyst: "analyst@meiji.com",
  viewer: "viewer@meiji.com",
  aoyama: "user@aoyama.com",
} as const;

type SeedRole = keyof typeof SEED_EMAILS;

let seeded: Record<SeedRole, string> | null = null;

/** Resolve the seeded profiles. Called from tests/setup.ts before collection. */
export async function loadSeededIdentities(): Promise<void> {
  if (seeded) return;
  const rows = await adminQuery<{ email: string; user_id: string }>(
    "select lower(email) as email, user_id from profiles where lower(email) = any($1)",
    [Object.values(SEED_EMAILS)]);
  const byEmail = new Map(rows.map((r) => [r.email, r.user_id]));
  const resolved = {} as Record<SeedRole, string>;
  for (const [role, email] of Object.entries(SEED_EMAILS) as [SeedRole, string][]) {
    const id = byEmail.get(email);
    if (!id) throw new Error(`Seeded profile ${email} is missing — was the database seeded?`);
    resolved[role] = id;
  }
  seeded = resolved;
  // adminSession is exported as a value, so mutate it rather than rebuild it:
  // every importer already holds this reference.
  adminSession.userId = resolved.admin;
}

export function seededUserId(role: SeedRole): string {
  if (!seeded) {
    throw new Error("Seeded identities not loaded — tests/setup.ts should have awaited loadSeededIdentities().");
  }
  return seeded[role];
}

/** Reiwa staff admin. `userId` is filled in by loadSeededIdentities(). */
export const adminSession: Session = {
  userId: "",
  orgIds: [],
  role: "reiwa_admin",
  canWrite: true,
};

export function orgUserSession(orgIds: string[], userId = seededUserId("analyst")): Session {
  return { userId, orgIds, role: "org_user", canWrite: true };
}
export function viewerSession(orgIds: string[], userId = seededUserId("viewer")): Session {
  return { userId, orgIds, role: "investor_viewer", canWrite: false };
}

export async function orgIdByName(name: string): Promise<string> {
  const rows = await adminQuery<{ org_id: string }>(
    "select org_id from organizations where name = $1", [name]);
  if (!rows[0]) throw new Error(`Organisation "${name}" not found — was the database seeded?`);
  return rows[0].org_id;
}

export async function profileIdByEmail(email: string): Promise<string> {
  const rows = await adminQuery<{ user_id: string }>(
    "select user_id from profiles where lower(email) = lower($1)", [email]);
  if (!rows[0]) throw new Error(`Profile "${email}" not found — was the database seeded?`);
  return rows[0].user_id;
}

// ---- Investment Portal (P1) ------------------------------------------------
/**
 * The Supabase Auth user id behind a seeded portal contact. This is the ONLY
 * thing an investor session carries: withInvestorSession() presents it as
 * `sub` and the database derives everything else.
 */
export async function investorAuthUserId(email: string): Promise<string> {
  const rows = await adminQuery<{ auth_user_id: string | null }>(
    "select auth_user_id from investor_contacts where lower(email) = lower($1)", [email]);
  if (!rows[0]?.auth_user_id) {
    throw new Error(`Investor contact "${email}" has no Supabase Auth user — was the database seeded?`);
  }
  return rows[0].auth_user_id;
}

export async function investorContactIdByEmail(email: string): Promise<string> {
  const rows = await adminQuery<{ investor_contact_id: string }>(
    "select investor_contact_id from investor_contacts where lower(email) = lower($1)", [email]);
  if (!rows[0]) throw new Error(`Investor contact "${email}" not found — was the database seeded?`);
  return rows[0].investor_contact_id;
}

export async function investorOrgIdByName(name: string): Promise<string> {
  const rows = await adminQuery<{ investor_org_id: string }>(
    "select investor_org_id from investor_organizations where name = $1", [name]);
  if (!rows[0]) throw new Error(`Investor organisation "${name}" not found — was the database seeded?`);
  return rows[0].investor_org_id;
}

/**
 * A seeded publication, found through its internal opportunity's name. The link
 * exists only in the admin-only `publication_sources` mapping, which is why this
 * lookup runs on the privileged connection.
 */
export async function publicationByOpportunityName(
  name: string,
): Promise<{ publicationId: string; opportunityId: string; activeVersionId: string | null }> {
  const rows = await adminQuery<{
    publication_id: string; opportunity_id: string; active_version_id: string | null;
  }>(
    `select p.publication_id, ps.opportunity_id, p.active_version_id
       from investor_publications p
       join publication_sources ps on ps.publication_id = p.publication_id
       join opportunities o on o.opportunity_id = ps.opportunity_id
      where o.name = $1`, [name]);
  if (!rows[0]) throw new Error(`Publication for "${name}" not found — was the database seeded?`);
  return {
    publicationId: rows[0].publication_id,
    opportunityId: rows[0].opportunity_id,
    activeVersionId: rows[0].active_version_id,
  };
}
