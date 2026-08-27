// ============================================================================
// Database client — real Postgres via PGlite (embedded, file-persistent).
// ----------------------------------------------------------------------------
// The SAME migrations run on Supabase. Two access modes mirror Supabase exactly:
//   * adminQuery  → superuser connection, bypasses RLS (auth, seeding, admin).
//   * withSession → opens a tx, `set local role authenticated` + request GUCs,
//                   so every query is gated by database RLS.
// Swapping to hosted Supabase = point a Postgres driver at DATABASE_URL and run
// the same SQL; the app code above this file does not change.
// ============================================================================
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type GlobalRole = "reiwa_admin" | "org_user" | "investor_viewer";

export interface Session {
  userId: string;
  orgIds: string[];
  role: GlobalRole;
  canWrite: boolean;
}

// A minimal query surface both PGlite and a tx expose.
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export async function runMigrations(db: Queryable): Promise<string[]> {
  await db.exec(`create table if not exists _migrations (
    name text primary key, applied_at timestamptz not null default now());`);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const name of files) {
    const { rows } = await db.query<{ name: string }>("select name from _migrations where name = $1", [name]);
    if (rows.length > 0) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    await db.exec("begin");
    try {
      await db.exec(sql);
      await db.query("insert into _migrations(name) values ($1)", [name]);
      await db.exec("commit");
      applied.push(name);
    } catch (e) {
      await db.exec("rollback");
      throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
    }
  }
  return applied;
}

// ---- Access helpers (parametrised on a db so tests can pass their own) ------
export async function adminQueryOn<T = Record<string, unknown>>(
  db: Queryable, sql: string, params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await db.query<T>(sql, params);
  return rows;
}

export async function withSessionOn<T>(
  db: PGlite, session: Session, fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('app.user_id', $1, true)", [session.userId]);
    await tx.query("select set_config('app.org_ids', $1, true)", [session.orgIds.join(",")]);
    await tx.query("select set_config('app.role', $1, true)", [session.role]);
    await tx.query("select set_config('app.can_write', $1, true)", [session.canWrite ? "true" : "false"]);
    return fn(tx as unknown as Queryable);
  }) as Promise<T>;
}

/** Fresh in-memory migrated database — for tests. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await runMigrations(db as unknown as Queryable);
  return db;
}

// ---- Application singleton (file-persistent) -------------------------------
function dataDir(): string {
  return process.env.PGLITE_DATA_DIR || join(process.cwd(), ".data", "pg");
}

declare global {
  // eslint-disable-next-line no-var
  var __reiwa_db: Promise<PGlite> | undefined;
}

async function bootstrap(): Promise<PGlite> {
  const db = new PGlite(dataDir());
  await db.waitReady;
  await runMigrations(db as unknown as Queryable);
  const { seedIfEmpty } = await import("@/lib/db/seed");
  await seedIfEmpty(db);
  return db;
}

export function getDb(): Promise<PGlite> {
  if (!globalThis.__reiwa_db) globalThis.__reiwa_db = bootstrap();
  return globalThis.__reiwa_db;
}

export async function adminQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return adminQueryOn<T>((await getDb()) as unknown as Queryable, sql, params);
}

export async function withSession<T>(session: Session, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return withSessionOn(await getDb(), session, fn);
}
