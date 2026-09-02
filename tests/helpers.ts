// ============================================================================
// Test helpers — run the suite against REAL PostgreSQL.
// ----------------------------------------------------------------------------
// Each call to freshDb() creates a throwaway database on the test server,
// applies the SAME migrations the app and Supabase run, and seeds it. Set
// TEST_DATABASE_ADMIN_URL to a privileged connection on your Postgres server
// (defaults to the local dev cluster used in this repo's verification).
// ============================================================================
import { randomBytes } from "node:crypto";
import {
  createDb, runMigrations, type Db, type Session, type GlobalRole,
} from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ||
  "postgres://postgres@127.0.0.1:55432/postgres";

function urlForDatabase(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Create an empty throwaway database; returns its url and a dropper. */
export async function createEmptyDatabase(): Promise<{ name: string; url: string; drop(): Promise<void> }> {
  const name = `reiwa_test_${randomBytes(6).toString("hex")}`;
  const admin = createDb(ADMIN_URL);
  await admin.exec(`create database ${name}`);
  await admin.close();
  return {
    name,
    url: urlForDatabase(name),
    async drop() {
      const a = createDb(ADMIN_URL);
      await a.exec(`drop database if exists ${name} with (force)`);
      await a.close();
    },
  };
}

export interface TestDb extends Db {
  name: string;
}

/** Fresh migrated + seeded database for a test; close() also drops it. */
export async function freshDb(): Promise<TestDb> {
  const empty = await createEmptyDatabase();
  const base = createDb(empty.url);
  await runMigrations(base);
  await seedIfEmpty(base);
  const db: TestDb = {
    ...base,
    name: empty.name,
    async close() {
      await base.close();
      await empty.drop();
    },
  };
  return db;
}

/**
 * Build a Session for a seeded user. Role and org scope are ALSO re-derived
 * inside the database from auth.uid() — the fields here drive app-side logic.
 */
export async function sessionFor(db: Db, email: string): Promise<Session> {
  const u = (await db.query<{ user_id: string; global_role: GlobalRole }>(
    "select user_id, global_role from users where email = $1", [email])).rows[0];
  if (!u) throw new Error(`Seeded user not found: ${email}`);
  const orgs = (await db.query<{ org_id: string }>(
    "select org_id from organization_members where user_id = $1", [u.user_id])).rows;
  return {
    userId: u.user_id,
    orgIds: orgs.map((r) => r.org_id),
    role: u.global_role,
    canWrite: u.global_role !== "investor_viewer",
  };
}

export const adminSession = (db: Db): Promise<Session> => sessionFor(db, "admin@reiwa.com");
export const analystSession = (db: Db): Promise<Session> => sessionFor(db, "analyst@meiji.com");
export const viewerSession = (db: Db): Promise<Session> => sessionFor(db, "viewer@meiji.com");
export const aoyamaSession = (db: Db): Promise<Session> => sessionFor(db, "user@aoyama.com");

export async function orgIdByName(db: Db, name: string): Promise<string> {
  const r = await db.query<{ org_id: string }>("select org_id from organizations where name = $1", [name]);
  return r.rows[0].org_id;
}

/** Point the data-layer singleton (withSession/adminQuery) at a test database. */
export function installTestDb(db: Db): void {
  (globalThis as unknown as { __reiwa_db?: Promise<Db> }).__reiwa_db = Promise.resolve(db);
}
export function clearTestDb(): void {
  (globalThis as unknown as { __reiwa_db?: Promise<Db> }).__reiwa_db = undefined;
}
