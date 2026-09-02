// ============================================================================
// Database client — Supabase-native access model.
// ----------------------------------------------------------------------------
// ACCESS MODES (approved P0 architecture):
//
//  1. withSession(session, fn)  — RLS-ENFORCED reads/writes.
//     Opens a transaction and runs:
//       SET LOCAL ROLE authenticated;
//       SET LOCAL request.jwt.claims = '{"sub":"<auth user id>", ...}';
//     so every query inside is gated by row-level security, and auth.uid()
//     resolves to the session's Supabase Auth user id. Authorisation derives
//     from DATABASE JOINS (membership tables) via the app.* helpers — never
//     from client-supplied claims.
//
//  2. adminQuery(sql, params)   — INTENTIONALLY PRIVILEGED DIRECT DB access.
//     Runs as the DATABASE_URL role (the table owner). Table owners bypass
//     non-FORCE RLS. Used only for migrations, seeding and auth-time identity
//     resolution. This is a database privilege — NOT a Supabase API key.
//
//  3. Supabase API-level privileged operations (Auth Admin: create staff
//     users, later investor pre-provisioning) use SUPABASE_SECRET_KEY via a
//     server-only supabase-js client — a separate credential and code path
//     (wired when Supabase connectivity is available; see docs/10).
//
// BACKENDS:
//  * PostgreSQL via `pg` against DATABASE_URL (Supabase: use the transaction
//    pooler string) — the production model. Migrations are applied by
//    scripts/db-migrate.mjs or the Supabase CLI, not at runtime.
//  * TRANSITIONAL fallback: embedded PGlite (+ supabase/shim/auth_shim.sql)
//    when DATABASE_URL is unset. Exists only until the hosted Supabase path is
//    proven (P0 step 12), then is deleted. Same migrations, same RLS.
// ============================================================================
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type GlobalRole = "reiwa_admin" | "org_user";

// The app session passed to withSession. `role`/`canWrite` are UI hints —
// RLS re-derives authorisation from the database via auth.uid() joins.
export interface Session {
  kind: "internal";
  userId: string; // Supabase Auth user id (auth.users.id)
  role: GlobalRole;
  canWrite: boolean;
}

// A minimal query surface every backend/transaction exposes.
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const AUTH_SHIM_PATH = join(process.cwd(), "supabase", "shim", "auth_shim.sql");

export function usesPostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

function claimsFor(session: Session): string {
  return JSON.stringify({ sub: session.userId, role: "authenticated" });
}

// ---- Migration runner (shared: PGlite bootstrap, tests, db-migrate script) --
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

/** Apply the dev/test auth shim ONLY where Supabase's auth schema is absent. */
export async function applyAuthShimIfNeeded(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from information_schema.schemata where schema_name = 'auth'");
  if ((rows[0]?.n ?? 0) > 0) return false;
  await db.exec(readFileSync(AUTH_SHIM_PATH, "utf8"));
  return true;
}

// ============================================================================
// Backend A — PostgreSQL via `pg` (DATABASE_URL; Supabase transaction pooler)
// ============================================================================
declare global {
  // eslint-disable-next-line no-var
  var __reiwa_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __reiwa_db: Promise<PGlite> | undefined;
}

function getPool(): Pool {
  if (!globalThis.__reiwa_pool) {
    const connectionString = process.env.DATABASE_URL!;
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    globalThis.__reiwa_pool = new Pool({
      connectionString,
      max: 5,
      // Supabase requires TLS. TODO(hardening, pre-prod): pin the Supabase CA
      // bundle instead of rejectUnauthorized:false.
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalThis.__reiwa_pool;
}

async function pgAdminQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  const res = await getPool().query(sql, params as never[]);
  return res.rows as T[];
}

async function pgWithSession<T>(session: Session, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [claimsFor(session)]);
    const tx: Queryable = {
      query: async (sql, params = []) => {
        const r = await client.query(sql, params as never[]);
        return { rows: r.rows };
      },
      exec: (sql) => client.query(sql),
    };
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// Backend B — TRANSITIONAL embedded PGlite (deleted at P0 step 12)
// ============================================================================
function dataDir(): string {
  return process.env.PGLITE_DATA_DIR || join(process.cwd(), ".data", "pg");
}

async function bootstrapPglite(): Promise<PGlite> {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true }); // PGlite's own mkdir is not recursive
  const db = new PGlite(dir);
  await db.waitReady;
  const q = db as unknown as Queryable;
  await applyAuthShimIfNeeded(q);
  await runMigrations(q);
  const { seedIfEmpty } = await import("@/lib/db/seed");
  await seedIfEmpty(db);
  return db;
}

export function getDb(): Promise<PGlite> {
  if (!globalThis.__reiwa_db) globalThis.__reiwa_db = bootstrapPglite();
  return globalThis.__reiwa_db;
}

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
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claimsFor(session)]);
    return fn(tx as unknown as Queryable);
  }) as Promise<T>;
}

/** Fresh in-memory Postgres (shim + migrations) — for tests. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  const q = db as unknown as Queryable;
  await applyAuthShimIfNeeded(q);
  await runMigrations(q);
  return db;
}

// ============================================================================
// Application API — backend-aware
// ============================================================================
export async function adminQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (usesPostgres()) return pgAdminQuery<T>(sql, params);
  return adminQueryOn<T>((await getDb()) as unknown as Queryable, sql, params);
}

export async function withSession<T>(session: Session, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (usesPostgres()) return pgWithSession(session, fn);
  return withSessionOn(await getDb(), session, fn);
}
