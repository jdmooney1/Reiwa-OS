// ============================================================================
// Database client — PostgreSQL (Supabase) via node-postgres.
// ----------------------------------------------------------------------------
// DATABASE_URL points at the Supabase transaction pooler (or any Postgres in
// dev/test). Two access modes, mirroring Supabase exactly:
//   * adminQuery  → the privileged connection, bypasses RLS (migrations,
//                   seeding, profile lookup). Conceptually separate from the
//                   SUPABASE_SECRET_KEY *API* credential, which only
//                   src/lib/auth/admin.ts uses.
//   * withSession → per-request transaction:
//                     set local role authenticated
//                     set_config('request.jwt.claims', <claims>, true)
//                   so every query runs in the same execution context
//                   Supabase's own stack gives it, gated by database RLS.
// Role and org scope are derived INSIDE the database from auth.uid()
// (migration 0001) — the Session object carries them for UI decisions only.
// ============================================================================
import { Pool, types } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Return date/timestamptz as ISO-ish strings (parity with the previous
// runtime; the UI and data layer treat dates as strings).
types.setTypeParser(types.builtins.DATE, (v: string) => v);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v: string) => v);
types.setTypeParser(types.builtins.TIMESTAMP, (v: string) => v);

export type GlobalRole = "reiwa_admin" | "org_user" | "investor_viewer";

export interface Session {
  userId: string;
  orgIds: string[];
  role: GlobalRole;
  canWrite: boolean;
}

// A minimal query surface a pool, a client and a tx all expose.
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

/** A connected database handle (wraps a pg Pool). */
export interface Db extends Queryable {
  pool: Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 10 });
  // Idle clients can be terminated server-side (failover, forced drop in
  // tests); without a listener that surfaces as an uncaught 'error' event.
  pool.on("error", () => { /* the next checkout opens a fresh connection */ });
  return {
    pool,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params as never[]);
      return { rows: res.rows as T[] };
    },
    // Multi-statement SQL (migrations) — no params → simple query protocol.
    async exec(sql: string) {
      return pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const AUTH_SHIM = join(process.cwd(), "supabase", "local", "auth_shim.sql");

export async function runMigrations(db: Db): Promise<string[]> {
  // A single dedicated connection: `begin`/`commit` and the session-scoped
  // advisory lock must all happen on the same client, never across a pool.
  const client = await db.pool.connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent boots (e.g. parallel server workers) on one lock.
    await client.query("select pg_advisory_lock(727274)");
    try {
      // On plain Postgres (dev/test) recreate the minimal Supabase `auth`
      // surface first; on hosted Supabase the schema exists → shim never runs.
      const authSchema = await client.query(
        "select 1 from pg_namespace where nspname = 'auth'");
      if (authSchema.rows.length === 0) {
        await client.query(readFileSync(AUTH_SHIM, "utf8"));
      }

      await client.query(`create table if not exists _migrations (
        name text primary key, applied_at timestamptz not null default now());`);
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      for (const name of files) {
        const { rows } = await client.query("select name from _migrations where name = $1", [name]);
        if (rows.length > 0) continue;
        const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
        try {
          await client.query("begin");
          await client.query(sql);
          await client.query("insert into _migrations(name) values ($1)", [name]);
          await client.query("commit");
          applied.push(name);
        } catch (e) {
          await client.query("rollback");
          throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock(727274)");
    }
  } finally {
    client.release();
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

/**
 * Run `fn` in a transaction under the `authenticated` role with the session's
 * verified identity as request.jwt.claims — the approved RLS transaction
 * model. Works unchanged on the Supabase transaction pooler because all
 * state is transaction-local (`set local` / set_config(..., true)).
 */
export async function withSessionOn<T>(
  db: Db, session: Session, fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await db.pool.connect();
  const tx: Queryable = {
    async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params as never[]);
      return { rows: res.rows as R[] };
    },
    async exec(sql: string) {
      return client.query(sql);
    },
  };
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    const claims = JSON.stringify({
      sub: session.userId,
      role: "authenticated",
      aud: "authenticated",
    });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* connection-level failure */ }
    throw e;
  } finally {
    client.release();
  }
}

// ---- Application singleton --------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __reiwa_db: Promise<Db> | undefined;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

async function bootstrap(): Promise<Db> {
  const db = createDb(databaseUrl());
  await runMigrations(db);
  const { seedIfEmpty } = await import("@/lib/db/seed");
  await seedIfEmpty(db);
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalThis.__reiwa_db) globalThis.__reiwa_db = bootstrap();
  return globalThis.__reiwa_db;
}

export async function adminQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return adminQueryOn<T>(await getDb(), sql, params);
}

export async function withSession<T>(session: Session, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return withSessionOn(await getDb(), session, fn);
}
