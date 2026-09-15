// ============================================================================
// The destructive-reset gate refuses. No database required, by design.
// ----------------------------------------------------------------------------
// These are the tests that would have caught the original defect: the harness
// reset whatever DATABASE_URL named, so a `npm test` with a development or
// production connection string in .env.local destroyed it.
//
// Every case below asserts a REFUSAL, and the last group asserts the thing that
// actually matters — that the refusal happens before any statement is issued.
// That is checked by giving the gate a recording fake in place of the reset, and
// proving the fake was never called.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  checkTestDatabaseEnv, assertDisposableTestDatabase, databaseIdentity,
  TestDatabaseRefusal, RESET_REFUSAL, ENVIRONMENT_MARKER_SETTING,
  type EnvSource, type MarkerReader,
} from "@/lib/db/test-database";

const APP_URL = "postgresql://postgres.liveproject:hunter2@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";
const TEST_URL = "postgresql://postgres.testproject:swordfish@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";

/** A fully correct environment. Each test spoils exactly one thing. */
function goodEnv(over: EnvSource = {}): EnvSource {
  return {
    NODE_ENV: "test",
    DATABASE_URL: APP_URL,
    TEST_DATABASE_URL: TEST_URL,
    ALLOW_TEST_DATABASE_RESET: "true",
    ...over,
  };
}

/** A marker reader that records every connection string it was asked about. */
function recordingMarker(value: string | null) {
  const asked: string[] = [];
  const read: MarkerReader = async (url) => { asked.push(url); return value; };
  return { read, asked };
}

// ---------------------------------------------------------------------------
describe("Condition 1 — an explicit test runtime", () => {
  it("refuses when NODE_ENV is not test", () => {
    for (const NODE_ENV of ["production", "development", undefined]) {
      expect(() => checkTestDatabaseEnv(goodEnv({ NODE_ENV })))
        .toThrow(TestDatabaseRefusal);
    }
  });

  it("names the runtime in the reason rather than failing vaguely", () => {
    try {
      checkTestDatabaseEnv(goodEnv({ NODE_ENV: "production" }));
      throw new Error("should have refused");
    } catch (e) {
      expect((e as TestDatabaseRefusal).reason).toContain('"production"');
      expect((e as Error).message).toContain(RESET_REFUSAL);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Condition 2 — TEST_DATABASE_URL, with no fallback", () => {
  it("refuses when TEST_DATABASE_URL is missing", () => {
    expect(() => checkTestDatabaseEnv(goodEnv({ TEST_DATABASE_URL: undefined })))
      .toThrow(TestDatabaseRefusal);
  });

  it("refuses when TEST_DATABASE_URL is blank", () => {
    expect(() => checkTestDatabaseEnv(goodEnv({ TEST_DATABASE_URL: "   " })))
      .toThrow(TestDatabaseRefusal);
  });

  it("never silently falls back to DATABASE_URL", () => {
    // The original defect in one assertion: a perfectly good DATABASE_URL must
    // not be enough to authorise anything.
    const env = goodEnv({ TEST_DATABASE_URL: undefined });
    expect(() => checkTestDatabaseEnv(env)).toThrow(/TEST_DATABASE_URL is not set/);
    try {
      checkTestDatabaseEnv(env);
    } catch (e) {
      expect((e as TestDatabaseRefusal).reason).not.toContain(APP_URL);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Condition 3 — the destructive opt-in", () => {
  it("refuses when ALLOW_TEST_DATABASE_RESET is absent", () => {
    expect(() => checkTestDatabaseEnv(goodEnv({ ALLOW_TEST_DATABASE_RESET: undefined })))
      .toThrow(TestDatabaseRefusal);
  });

  it("accepts only the exact string 'true'", () => {
    for (const value of ["TRUE", "True", "1", "yes", "on", ""]) {
      expect(() => checkTestDatabaseEnv(goodEnv({ ALLOW_TEST_DATABASE_RESET: value })))
        .toThrow(TestDatabaseRefusal);
    }
    expect(checkTestDatabaseEnv(goodEnv({ ALLOW_TEST_DATABASE_RESET: "true" })))
      .toBe(TEST_URL);
  });

  it("is not required when the caller only connects, never resets", () => {
    // Playwright reads and writes rows against an already-seeded test database.
    // Demanding the destructive flag there would teach everybody to export it.
    const env = goodEnv({ ALLOW_TEST_DATABASE_RESET: undefined, NODE_ENV: undefined });
    expect(checkTestDatabaseEnv(env, { purpose: "connect" })).toBe(TEST_URL);
  });

  it("still holds a connecting caller to the test-database rules", () => {
    // Relaxing the destructive conditions must not relax the ones that decide
    // WHICH database is being touched.
    for (const over of [
      { TEST_DATABASE_URL: undefined },
      { TEST_DATABASE_URL: APP_URL },
    ]) {
      expect(() => checkTestDatabaseEnv(goodEnv(over), { purpose: "connect" }))
        .toThrow(TestDatabaseRefusal);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Condition 4a — never an application database", () => {
  it("refuses a TEST_DATABASE_URL identical to DATABASE_URL", () => {
    expect(() => checkTestDatabaseEnv(goodEnv({ TEST_DATABASE_URL: APP_URL })))
      .toThrow(/names the same database as DATABASE_URL/);
  });

  it("refuses the same database reached on a different port", () => {
    // The pooler on 6543 and a direct connection on 5432 are the same database.
    const direct = APP_URL.replace(":6543", ":5432");
    expect(() => checkTestDatabaseEnv(goodEnv({ TEST_DATABASE_URL: direct })))
      .toThrow(/names the same database as DATABASE_URL/);
  });

  it("refuses the same database reached with a rotated password", () => {
    const rotated = APP_URL.replace("hunter2", "a-new-password");
    expect(() => checkTestDatabaseEnv(goodEnv({ TEST_DATABASE_URL: rotated })))
      .toThrow(/names the same database as DATABASE_URL/);
  });

  it("refuses a match against staging, development or production URLs", () => {
    for (const name of [
      "PRODUCTION_DATABASE_URL", "PROD_DATABASE_URL",
      "STAGING_DATABASE_URL", "DEV_DATABASE_URL", "DEVELOPMENT_DATABASE_URL",
    ]) {
      const env = goodEnv({ DATABASE_URL: undefined, [name]: TEST_URL });
      expect(() => checkTestDatabaseEnv(env))
        .toThrow(new RegExp(`names the same database as ${name}`));
    }
  });

  it("allows a genuinely separate Supabase project in the same region", () => {
    // Every project in a region shares the pooler hostname and the database
    // name `postgres`; only the project ref in the username distinguishes them.
    // Comparing on host and database alone would refuse a good test project.
    expect(databaseIdentity(APP_URL)).not.toBe(databaseIdentity(TEST_URL));
    expect(checkTestDatabaseEnv(goodEnv())).toBe(TEST_URL);
  });

  it("compares unparseable connection strings literally rather than ignoring them", () => {
    const junk = "not a url at all";
    expect(() => checkTestDatabaseEnv(
      goodEnv({ DATABASE_URL: junk, TEST_DATABASE_URL: junk })))
      .toThrow(/names the same database as DATABASE_URL/);
  });
});

// ---------------------------------------------------------------------------
describe("Condition 4b — the database's own disposability marker", () => {
  it("accepts a correctly marked disposable test database", async () => {
    const marker = recordingMarker("test");
    await expect(assertDisposableTestDatabase(goodEnv(), marker.read))
      .resolves.toBe(TEST_URL);
    // It asked the TEST database, not the application's.
    expect(marker.asked).toEqual([TEST_URL]);
  });

  it("refuses when the marker is absent", async () => {
    const marker = recordingMarker(null);
    await expect(assertDisposableTestDatabase(goodEnv(), marker.read))
      .rejects.toThrow(new RegExp(`${ENVIRONMENT_MARKER_SETTING} is not set`));
  });

  it("refuses when the marker names another environment", async () => {
    for (const value of ["production", "staging", "development", "dev"]) {
      const marker = recordingMarker(value);
      await expect(assertDisposableTestDatabase(goodEnv(), marker.read))
        .rejects.toThrow(TestDatabaseRefusal);
    }
  });

  it("refuses a marker that merely contains 'test'", async () => {
    // A name is a convention; the marker is an assertion. "not-a-test-database"
    // must not pass because it has the right substring in it.
    for (const value of ["not-a-test-database", "testing", "pretest", "TEST"]) {
      const marker = recordingMarker(value);
      await expect(assertDisposableTestDatabase(goodEnv(), marker.read))
        .rejects.toThrow(TestDatabaseRefusal);
    }
  });

  it("refuses when the database cannot be asked at all", async () => {
    const exploding: MarkerReader = async () => { throw new Error("ECONNREFUSED"); };
    await expect(assertDisposableTestDatabase(goodEnv(), exploding))
      .rejects.toThrow(/could not be asked whether it is disposable/);
  });
});

// ---------------------------------------------------------------------------
// Every way the gate must refuse. `marker` is what the target database would
// answer, so the last case is a real database that simply is not marked.
const REFUSALS: { label: string; env: EnvSource; marker: string | null }[] = [
  { label: "wrong runtime", env: goodEnv({ NODE_ENV: "production" }), marker: "test" },
  { label: "no TEST_DATABASE_URL", env: goodEnv({ TEST_DATABASE_URL: undefined }), marker: "test" },
  { label: "no opt-in", env: goodEnv({ ALLOW_TEST_DATABASE_RESET: undefined }), marker: "test" },
  { label: "test URL is the app URL", env: goodEnv({ TEST_DATABASE_URL: APP_URL }), marker: "test" },
  { label: "unmarked database", env: goodEnv(), marker: null },
  { label: "production database", env: goodEnv(), marker: "production" },
];

// The property that makes the rest of it worth anything.
describe("Refusal happens before anything is destroyed", () => {
  it("never opens a connection when the environment is wrong", async () => {
    // The four environment conditions are decided with no I/O at all, so a
    // misconfigured run is refused before it can even reach the database.
    for (const { label, env, marker: value } of REFUSALS.slice(0, 4)) {
      const marker = recordingMarker(value);
      await expect(assertDisposableTestDatabase(env, marker.read))
        .rejects.toThrow(TestDatabaseRefusal);
      expect({ label, asked: marker.asked }).toEqual({ label, asked: [] });
    }
  });

  it("never runs the reset when the gate refuses, for any reason", async () => {
    // Stands in for resetDatabase(). If the gate lets anything through, this
    // records the statement that would have destroyed the database.
    const statements: string[] = [];

    for (const { env, marker: value } of REFUSALS) {
      try {
        await assertDisposableTestDatabase(env, recordingMarker(value).read);
        statements.push("drop schema if exists app cascade");
      } catch { /* every one of these must refuse */ }
    }
    expect(statements).toEqual([]);
  });

  it("runs the reset only once every condition holds", async () => {
    const statements: string[] = [];
    const url = await assertDisposableTestDatabase(goodEnv(), recordingMarker("test").read);
    statements.push(`reset ${databaseIdentity(url)}`);
    expect(statements).toEqual([
      "reset postgres.testproject@aws-0-ap-northeast-1.pooler.supabase.com/postgres",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("Every refusal carries the same loud headline", () => {
  it("leads with the required sentence whatever the reason", async () => {
    for (const { label, env, marker: value } of REFUSALS) {
      try {
        await assertDisposableTestDatabase(env, recordingMarker(value).read);
        throw new Error(`should have refused: ${label}`);
      } catch (e) {
        expect((e as Error).message.split("\n")[0]).toBe(RESET_REFUSAL);
      }
    }
  });

  it("tells the reader how to provision a test database", () => {
    try {
      checkTestDatabaseEnv(goodEnv({ TEST_DATABASE_URL: undefined }));
      throw new Error("should have refused");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("ALTER DATABASE");
      expect(message).toContain("docs/19-test-database-safety.md");
    }
  });
});
