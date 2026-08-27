import { PGlite } from "@electric-sql/pglite";
import { runMigrations, type Queryable, type Session } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";

/** Fresh in-memory, migrated + seeded database for a test. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await runMigrations(db as unknown as Queryable);
  await seedIfEmpty(db);
  return db;
}

export const adminSession: Session = { userId: "00000000-0000-0000-0000-000000000000", orgIds: [], role: "reiwa_admin", canWrite: true };

export function orgUserSession(orgIds: string[], userId = "11111111-1111-1111-1111-111111111111"): Session {
  return { userId, orgIds, role: "org_user", canWrite: true };
}
export function viewerSession(orgIds: string[], userId = "22222222-2222-2222-2222-222222222222"): Session {
  return { userId, orgIds, role: "investor_viewer", canWrite: false };
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
