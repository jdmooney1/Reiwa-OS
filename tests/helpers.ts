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

export const adminSession: Session = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgIds: [],
  role: "reiwa_admin",
  canWrite: true,
};

export function orgUserSession(orgIds: string[], userId = "11111111-1111-1111-1111-111111111111"): Session {
  return { userId, orgIds, role: "org_user", canWrite: true };
}
export function viewerSession(orgIds: string[], userId = "22222222-2222-2222-2222-222222222222"): Session {
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
