// ============================================================================
// Database client — hosted Supabase PostgreSQL over node-postgres.
// ----------------------------------------------------------------------------
// Two access modes, deliberately kept separate:
//   * adminQuery  → privileged connection (the `postgres` role, BYPASSRLS).
//                   Sign-in support, session assembly, migrations, seeding.
//   * withSession → opens a transaction, `set local role authenticated` and sets
//                   the Supabase claims GUC `request.jwt.claims`, so every query
//                   inside is gated by database RLS.
//
// This module is the ONLY place that speaks Postgres. Supabase's HTTP APIs
// (Auth / PostgREST, authenticated with SUPABASE_SECRET_KEY or the publishable
// key) live under src/lib/supabase/ and never share a credential with this file.
// ============================================================================
import { Pool, types, type PoolClient } from "pg";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type GlobalRole = "reiwa_admin" | "org_user" | "investor_viewer";

export interface Session {
  userId: string;
  orgIds: string[];
  role: GlobalRole;
  canWrite: boolean;
}

// A minimal query surface both the pool and a transaction expose.
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

// ---- Type parsing ----------------------------------------------------------
// Dates and timestamps are surfaced as strings so the data layer keeps the
// `string` shapes it already declares; numerics stay strings and are coerced in
// src/lib/data/coerce.ts.
const OID_DATE = 1082, OID_TIMESTAMP = 1114, OID_TIMESTAMPTZ = 1184;
const defaultTimestamp = types.getTypeParser(OID_TIMESTAMP);
const defaultTimestamptz = types.getTypeParser(OID_TIMESTAMPTZ);
const toIso = (parse: (v: string) => unknown) => (raw: string): string | null => {
  if (raw === null) return null;
  const parsed = parse(raw);
  return parsed instanceof Date ? parsed.toISOString() : String(parsed);
};
types.setTypeParser(OID_DATE, (v) => v); // 'YYYY-MM-DD', verbatim
types.setTypeParser(OID_TIMESTAMP, toIso(defaultTimestamp as (v: string) => unknown));
types.setTypeParser(OID_TIMESTAMPTZ, toIso(defaultTimestamptz as (v: string) => unknown));

// ---- Connection ------------------------------------------------------------
/**
 * The Supabase pooler presents a certificate issued by Supabase's own CA, which
 * is not in the public trust store. Verification stays ON and the shipped root
 * (supabase/prod-ca-2021.crt, overridable with SUPABASE_DB_CA_CERT) is added as
 * an extra trust anchor.
 */
function sslConfig(connectionString: string): { ca: string; rejectUnauthorized: true } | undefined {
  if (connectionString.includes("sslmode=disable")) return undefined;
  const custom = process.env.SUPABASE_DB_CA_CERT;
  if (custom && custom.includes("BEGIN CERTIFICATE")) {
    return { ca: custom, rejectUnauthorized: true };
  }
  const path = custom || join(process.cwd(), "supabase", "prod-ca-2021.crt");
  if (!existsSync(path)) {
    throw new Error(
      `Supabase root CA not found at ${path}. Set SUPABASE_DB_CA_CERT to the certificate (or its path).`,
    );
  }
  return { ca: readFileSync(path, "utf8"), rejectUnauthorized: true };
}

declare global {
  // eslint-disable-next-line no-var
  var __reiwa_pool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — the Supabase Postgres connection string is required.");
  }
  return new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    application_name: "reiwa-os",
    // The Supabase transaction pooler multiplexes; keep the local pool modest
    // and hand connections back quickly.
    max: Number(process.env.DATABASE_POOL_MAX ?? 8),
    // A pooled connection that has been idle for a while may already have been
    // dropped by the pooler or by something in between, and the application
    // only finds out when it borrows it and gets ECONNRESET mid-statement.
    // Two settings make that rare rather than routine: retire local
    // connections well before anything upstream is likely to, and keep the
    // socket demonstrably alive while it is held.
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    // Only unnamed (single-use) statements are issued, which the transaction
    // pooler supports; node-postgres does this unless a query `name` is given.
  });
}

// ---- Connection acquisition ------------------------------------------------
/** Attempts to BORROW a connection. Nothing about a statement is retried. */
const CONNECT_ATTEMPTS = 3;
const CONNECT_BACKOFF_MS = [100, 400];

/**
 * True for the failures that mean "this pooled socket was already dead", as
 * opposed to a failure that says something about the work being attempted.
 */
function isTransientConnectionError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code && ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "57P01"].includes(err.code)) {
    return true;
  }
  return /connection terminated|connection reset|server closed the connection/i
    .test(err?.message ?? "");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Borrow a connection, retrying ONLY the acquisition.
 *
 * This is the one place a retry is safe. A stale pooled socket fails before any
 * statement of ours has been issued, so trying again cannot repeat work. The
 * moment a transaction is open — or even a single implicit-transaction
 * statement has been sent — a retry stops being safe: a write may already have
 * committed on the far side of a connection that died before the acknowledgement
 * came back, and re-running it would duplicate it. So nothing in this module
 * retries a statement or replays a transaction. A caller that wants that has to
 * decide it is idempotent and say so explicitly.
 */
async function acquire(pool: Pool): Promise<PoolClient> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await pool.connect();
    } catch (e) {
      lastError = e;
      if (!isTransientConnectionError(e) || attempt === CONNECT_ATTEMPTS - 1) throw e;
      await sleep(CONNECT_BACKOFF_MS[attempt] ?? 400);
    }
  }
  throw lastError;
}

/** Process-wide pool. Survives Next.js dev hot-reloads via globalThis. */
export function getPool(): Pool {
  if (!globalThis.__reiwa_pool) {
    const pool = createPool();
    // A pooled connection dying in the background must not crash the process.
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
    globalThis.__reiwa_pool = pool;
  }
  return globalThis.__reiwa_pool;
}

/** Close the pool (tests, scripts, graceful shutdown). */
export async function closePool(): Promise<void> {
  const pool = globalThis.__reiwa_pool;
  globalThis.__reiwa_pool = undefined;
  if (pool) await pool.end();
}

function wrap(client: PoolClient | Pool): Queryable {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params as unknown[]);
      return { rows: res.rows as T[] };
    },
    async exec(sql: string) {
      return client.query(sql);
    },
  };
}

// ---- Migrations ------------------------------------------------------------
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Apply pending migrations on a single privileged connection. The ledger lives
 * in the private `app` schema, not `public`, so it is never exposed by PostgREST.
 */
export async function runMigrations(pool: Pool = getPool()): Promise<string[]> {
  const client = await acquire(pool);
  const applied: string[] = [];
  try {
    await client.query("create schema if not exists app");
    await client.query(`create table if not exists app._migrations (
      name text primary key, applied_at timestamptz not null default now());`);
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const name of files) {
      const { rows } = await client.query("select name from app._migrations where name = $1", [name]);
      if (rows.length > 0) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into app._migrations(name) values ($1)", [name]);
        await client.query("commit");
        applied.push(name);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return applied;
}

// ---- Access helpers (parametrised on a pool so scripts/tests can pass theirs) ----
export async function adminQueryOn<T = Record<string, unknown>>(
  db: Queryable, sql: string, params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await db.query<T>(sql, params);
  return rows;
}

/** The Supabase claims this session presents to RLS inside a transaction. */
export function sessionClaims(session: Session): Record<string, unknown> {
  return {
    sub: session.userId,
    role: "authenticated",
    app_metadata: {
      global_role: session.role,
      org_ids: session.orgIds,
      can_write: session.canWrite,
    },
  };
}

/**
 * Run `fn` inside one transaction as the `authenticated` role with this
 * session's claims installed. Both the role and the claims are SET LOCAL, so
 * they are discarded at COMMIT/ROLLBACK and never leak to the next borrower of
 * the pooled connection.
 */
export async function withSessionOn<T>(
  pool: Pool, session: Session, fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  // Acquisition may be retried; the transaction below runs exactly once.
  const client = await acquire(pool);
  try {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(sessionClaims(session)),
      ]);
      const out = await fn(wrap(client));
      await client.query("commit");
      return out;
    } catch (e) {
      try { await client.query("rollback"); } catch { /* connection already gone */ }
      throw e;
    }
  } finally {
    client.release();
  }
}

// ---- Application-level helpers ---------------------------------------------
/**
 * Privileged query — bypasses RLS. Never reachable from a user-supplied path.
 *
 * The connection is borrowed explicitly rather than through pool.query() so a
 * stale pooled socket is retried at acquisition, where retrying is free of
 * consequence. The statement itself is then issued exactly once: a single
 * statement is its own transaction, and one that dies after being sent may
 * already have committed, so re-sending it could duplicate a write.
 */
export async function adminQuery<T = Record<string, unknown>>(
  sql: string, params: unknown[] = [],
): Promise<T[]> {
  const client = await acquire(getPool());
  try {
    return await adminQueryOn<T>(wrap(client), sql, params);
  } finally {
    client.release();
  }
}

/** RLS-gated unit of work for a signed-in user. */
export async function withSession<T>(session: Session, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return withSessionOn(getPool(), session, fn);
}

// ---- Investment Portal sessions --------------------------------------------
/**
 * The claims an investor presents. Deliberately just the Supabase user id: no
 * organisation, no entitlement, no document tier, no global role. Everything an
 * investor is allowed to see is derived inside the database from `auth.uid()`
 * (see app.current_investor_org_id() and friends in migration 0005), so there is
 * nothing here for the application — or a tampered token — to get wrong.
 */
export function investorSessionClaims(authUserId: string): Record<string, unknown> {
  return { sub: authUserId, role: "authenticated", app_metadata: {} };
}

export async function withInvestorSessionOn<T>(
  pool: Pool, authUserId: string, fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  // Acquisition may be retried; the transaction below runs exactly once.
  const client = await acquire(pool);
  try {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(investorSessionClaims(authUserId)),
      ]);
      const out = await fn(wrap(client));
      await client.query("commit");
      return out;
    } catch (e) {
      try { await client.query("rollback"); } catch { /* connection already gone */ }
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * RLS-gated unit of work for a portal investor, identified only by their
 * Supabase Auth user id. An investor has no `profiles` row and no
 * `organization_members` row, so every internal policy (app.has_org) denies them
 * by construction; migration 0005 grants the narrow portal access instead.
 */
export async function withInvestorSession<T>(
  authUserId: string, fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return withInvestorSessionOn(getPool(), authUserId, fn);
}
