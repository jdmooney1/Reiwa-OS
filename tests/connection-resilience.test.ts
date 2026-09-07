// ============================================================================
// P6 — connection resilience and reset reliability.
// ----------------------------------------------------------------------------
// Two failures showed up against the real Supabase pooler:
//
//   * occasional ECONNRESET when a pooled connection that had been idle a while
//     was borrowed — the socket was already gone upstream and the application
//     only discovered it mid-statement;
//   * the schema reset creeping towards the pooler's statement timeout, because
//     teardown was 27 separate DDL round trips each of which had to re-resolve
//     the triggers and policies hanging off `app`.
//
// The fix for the first is bounded retry on ACQUISITION ONLY. That distinction
// is the whole safety argument and is what most of this file tests: a retry
// before any statement has been sent cannot repeat work, and a retry after one
// has been sent can — a write may have committed on the far side of a
// connection that died before the acknowledgement came back. So no transaction
// is ever replayed and no statement is ever re-sent, however transient the
// failure looks.
//
// The fix for the second is ordering: drop `app` first so cascade takes the
// triggers and policies with it, then drop the tables in one statement. The
// timing benefit is latency-bound and cannot be measured meaningfully against a
// local database, so what is asserted here is the mechanism that produces it —
// the number of round trips and the order they happen in.
// ============================================================================
import { describe, it, expect } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  getPool, adminQuery, withSessionOn, withInvestorSessionOn, closePool,
} from "@/lib/db/client";
import { dropSchema, resetDatabase } from "@/lib/db/reset";
import { adminSession } from "./helpers";

/** A pool that records every statement and can be told to fail on connect. */
function fakePool(options: {
  connectFailures?: { code?: string; message?: string }[];
  failOn?: RegExp;
} = {}) {
  const statements: string[] = [];
  const failures = [...(options.connectFailures ?? [])];
  let connects = 0;
  let released = 0;

  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (options.failOn?.test(sql)) throw new Error(`refused: ${sql}`);
      return { rows: [], rowCount: 0 };
    },
    release() { released += 1; },
  } as unknown as PoolClient;

  const pool = {
    async connect() {
      connects += 1;
      const failure = failures.shift();
      if (failure) {
        const error = new Error(failure.message ?? "connection error") as Error & { code?: string };
        error.code = failure.code;
        throw error;
      }
      return client;
    },
  } as unknown as Pool;

  return {
    pool,
    statements,
    get connects() { return connects; },
    get released() { return released; },
  };
}

// ============================================================================
describe("The pool is configured for a pooler that drops idle connections", () => {
  it("keeps the socket alive and retires local connections early", () => {
    const pool = getPool() as unknown as {
      options: {
        keepAlive?: boolean;
        keepAliveInitialDelayMillis?: number;
        idleTimeoutMillis?: number;
        connectionTimeoutMillis?: number;
        max?: number;
      };
    };
    expect(pool.options.keepAlive).toBe(true);
    expect(pool.options.keepAliveInitialDelayMillis).toBeGreaterThan(0);
    // Short enough that a local connection is retired long before anything
    // upstream is likely to have dropped it.
    expect(pool.options.idleTimeoutMillis).toBeLessThanOrEqual(10_000);
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
  });
});

// ============================================================================
describe("Retry is bounded, and confined to acquisition", () => {
  it("retries a transient acquisition failure and then proceeds", async () => {
    const fake = fakePool({ connectFailures: [{ code: "ECONNRESET" }] });
    await withSessionOn(fake.pool, adminSession, async () => "done");
    expect(fake.connects).toBe(2);
    expect(fake.released).toBe(1);
    // The transaction itself ran once, on the connection that worked.
    expect(fake.statements.filter((s) => s === "begin").length).toBe(1);
    expect(fake.statements.filter((s) => s === "commit").length).toBe(1);
  });

  it("gives up after a bounded number of attempts rather than looping", async () => {
    const fake = fakePool({
      connectFailures: [
        { code: "ECONNRESET" }, { code: "ECONNRESET" }, { code: "ECONNRESET" },
        { code: "ECONNRESET" }, { code: "ECONNRESET" },
      ],
    });
    await expect(withSessionOn(fake.pool, adminSession, async () => "done"))
      .rejects.toThrow();
    expect(fake.connects).toBe(3);
  });

  it("does not retry a failure that is about the work rather than the socket", async () => {
    const fake = fakePool({
      connectFailures: [{ code: "28P01", message: "password authentication failed" }],
    });
    await expect(withSessionOn(fake.pool, adminSession, async () => "done"))
      .rejects.toThrow(/password authentication failed/);
    expect(fake.connects).toBe(1);
  });

  it("recognises a stale socket by message as well as by code", async () => {
    const fake = fakePool({
      connectFailures: [{ message: "Connection terminated unexpectedly" }],
    });
    await withInvestorSessionOn(fake.pool, "11111111-1111-4111-8111-111111111111",
      async () => "done");
    expect(fake.connects).toBe(2);
  });
});

// ============================================================================
describe("An in-flight transaction is never replayed", () => {
  it("runs the transaction body exactly once, even when it fails", async () => {
    const fake = fakePool();
    let calls = 0;
    await expect(withSessionOn(fake.pool, adminSession, async () => {
      calls += 1;
      const error = new Error("Connection terminated unexpectedly") as Error & { code?: string };
      error.code = "ECONNRESET";
      throw error;
    })).rejects.toThrow();

    // The failure looks exactly like the transient one that IS retried at
    // acquisition. It is not retried here, because a write inside it may
    // already have committed.
    expect(calls).toBe(1);
    expect(fake.connects).toBe(1);
    expect(fake.statements.filter((s) => s === "begin").length).toBe(1);
    expect(fake.statements.filter((s) => s === "rollback").length).toBe(1);
    expect(fake.statements).not.toContain("commit");
  });

  it("does not re-send a statement that failed after being issued", async () => {
    const fake = fakePool({ failOn: /^insert/ });
    await expect(withSessionOn(fake.pool, adminSession, (tx) =>
      tx.query("insert into t(a) values (1)"))).rejects.toThrow();
    expect(fake.statements.filter((s) => s.startsWith("insert")).length).toBe(1);
  });

  it("releases the connection even when the transaction fails", async () => {
    const fake = fakePool();
    await expect(withSessionOn(fake.pool, adminSession, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(fake.released).toBe(1);
  });
});

// ============================================================================
describe("Schema teardown", () => {
  it("drops app before the tables, so cascade removes the triggers first", async () => {
    const fake = fakePool();
    await dropSchema(fake.pool);

    const appDrop = fake.statements.findIndex((s) => /drop schema if exists app/.test(s));
    const tableDrop = fake.statements.findIndex((s) => /drop table if exists/.test(s));
    expect(appDrop).toBeGreaterThanOrEqual(0);
    expect(tableDrop).toBeGreaterThanOrEqual(0);
    expect(appDrop).toBeLessThan(tableDrop);
  });

  it("drops every table in one statement rather than one round trip each", async () => {
    const fake = fakePool();
    await dropSchema(fake.pool);

    const tableDrops = fake.statements.filter((s) => /drop table if exists/.test(s));
    expect(tableDrops.length).toBe(1);
    // ...and that one statement really does name them all.
    for (const table of ["investor_invites", "publication_documents", "organizations", "fx_rates"]) {
      expect(tableDrops[0]).toContain(`public.${table}`);
    }
  });

  it("keeps the whole teardown to a handful of round trips", async () => {
    const fake = fakePool();
    await dropSchema(fake.pool);
    // begin, statement_timeout, drop schema, drop view, drop tables, commit.
    expect(fake.statements.length).toBeLessThanOrEqual(8);
  });

  it("bounds the teardown with an explicit statement timeout", async () => {
    const fake = fakePool();
    await dropSchema(fake.pool);
    expect(fake.statements.some((s) => /set local statement_timeout/.test(s))).toBe(true);
  });

  it("rolls back and reports rather than leaving a half-dropped schema", async () => {
    const fake = fakePool({ failOn: /drop table/ });
    await expect(dropSchema(fake.pool)).rejects.toThrow();
    expect(fake.statements).toContain("rollback");
    expect(fake.statements).not.toContain("commit");
    expect(fake.released).toBe(1);
  });
});

// ============================================================================
describe("Reset is repeatable against the real database", () => {
  it("resets twice in a row and leaves a working, seeded schema", async () => {
    for (let run = 0; run < 2; run += 1) {
      const applied = await resetDatabase();
      expect(applied.length).toBeGreaterThan(0);
      const orgs = await adminQuery<{ n: string }>(
        "select count(*)::text as n from organizations");
      expect(Number(orgs[0].n)).toBeGreaterThan(0);
    }
  }, 180_000);

  it("survives the pool being closed and reopened between units of work", async () => {
    await adminQuery("select 1");
    await closePool();
    // The next call rebuilds the pool rather than failing on a dead one.
    const rows = await adminQuery<{ ok: number }>("select 1 as ok");
    expect(rows[0].ok).toBe(1);
  });
});
