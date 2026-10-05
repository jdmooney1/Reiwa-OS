// ============================================================================
// /api/cron/fx-sync: not a public endpoint. The sync itself is mocked; what is
// asserted is that it does not run without the right secret.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ ran: 0, outcome: { status: "ok", asOf: "2026-10-02", written: ["EUR"], deferred: [] } as Record<string, unknown> }));
vi.mock("@/lib/data/fx-sync", () => ({ runFxSync: async () => { state.ran++; return state.outcome; } }));

const SECRET = "cron-secret-long-enough-0123456789";
const call = async (headers: Record<string, string> = {}) =>
  (await import("@/app/api/cron/fx-sync/route")).GET(new Request("https://example.test/api/cron/fx-sync", { headers }));

const saved = process.env.CRON_SECRET;
beforeEach(() => { state.ran = 0; state.outcome = { status: "ok", asOf: "2026-10-02", written: ["EUR"], deferred: [] }; process.env.CRON_SECRET = SECRET; });
afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

describe("GET /api/cron/fx-sync", () => {
  it("401s with no Authorization header, and does not run the sync", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(state.ran).toBe(0);
  });

  it("401s with a wrong secret, a wrong scheme or a near miss", async () => {
    for (const h of ["Bearer nope", `Basic ${SECRET}`, SECRET, `Bearer ${SECRET}x`]) {
      expect((await call({ authorization: h })).status, h).toBe(401);
    }
    expect(state.ran).toBe(0);
  });

  it("says nothing about why it refused", async () => {
    expect(await (await call({ authorization: "Bearer nope" })).json()).toEqual({ error: "Unauthorised" });
  });

  it("401s EVERY request when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: "Bearer undefined" })).status).toBe(401);
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect(state.ran).toBe(0);
  });

  it("runs the sync for the right secret and returns its outcome", async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", written: ["EUR"] });
    expect(state.ran).toBe(1);
  });

  it("answers 502 when the sync failed, so Vercel shows the invocation as failed", async () => {
    state.outcome = { status: "failed", asOf: null, written: [], deferred: [], error: "The ECB feed answered 503." };
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(502);
  });
});
