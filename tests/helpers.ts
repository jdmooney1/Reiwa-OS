import { PGlite } from "@electric-sql/pglite";
import {
  runMigrations, applyAuthShimIfNeeded, type Queryable, type Session, type GlobalRole,
} from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";

/** Fresh in-memory Postgres: auth shim + Supabase-native migrations + seed. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  const q = db as unknown as Queryable;
  await applyAuthShimIfNeeded(q);
  await runMigrations(q);
  await seedIfEmpty(db);
  return db;
}

/**
 * Session for a seeded identity. RLS derives authorisation from auth.uid()
 * membership joins, so sessions must reference REAL seeded user ids.
 */
export async function sessionFor(db: PGlite, email: string): Promise<Session> {
  const u = (await db.query<{ user_id: string; global_role: GlobalRole }>(
    "select user_id, global_role from users where email = $1", [email])).rows[0];
  if (!u) throw new Error(`No seeded user for ${email}`);
  const w = (await db.query<{ n: number }>(
    "select count(*)::int as n from organization_members where user_id = $1 and role in ('owner','manager','analyst')",
    [u.user_id])).rows[0];
  return {
    kind: "internal",
    userId: u.user_id,
    role: u.global_role,
    canWrite: u.global_role === "reiwa_admin" || (w?.n ?? 0) > 0,
  };
}

export async function orgIdByName(db: PGlite, name: string): Promise<string> {
  const r = await db.query<{ org_id: string }>("select org_id from organizations where name = $1", [name]);
  return r.rows[0].org_id;
}

/** Point the data-layer singleton (withSession/adminQuery) at a test database. */
export function installTestDb(db: PGlite): void {
  (globalThis as unknown as { __reiwa_db?: Promise<PGlite> }).__reiwa_db = Promise.resolve(db);
}
export function clearTestDb(): void {
  (globalThis as unknown as { __reiwa_db?: Promise<PGlite> }).__reiwa_db = undefined;
}
