// ============================================================================
// saveFxRateAction: admin only, source required, and nothing reaches the write
// unless every check has passed.
// ----------------------------------------------------------------------------
// No database: the session and the data layer are mocked, so what is asserted is
// the ORDER of the checks. The same rules against real RLS are in
// tests/fx-rates.test.ts.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  session: { userId: "u1", orgIds: [], role: "reiwa_admin", canWrite: true } as Record<string, unknown>,
  saved: [] as unknown[][],
  revalidated: [] as string[],
  saveThrows: null as Error | null,
}));

vi.mock("@/lib/auth/session", () => ({ requireDbSession: async () => state.session }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));
vi.mock("@/lib/data/fx-rates", () => ({
  todayUtc: () => "2026-10-05",
  saveFxRate: async (...args: unknown[]) => { if (state.saveThrows) throw state.saveThrows; state.saved.push(args); },
}));

const good = { currency: "EUR", rate: "0.8512", source: "ECB euro reference rate", asOf: "2026-10-03" };
const run = async (body: unknown) => (await import("@/app/actions/fx")).saveFxRateAction(body);

beforeEach(() => {
  state.session = { userId: "u1", orgIds: [], role: "reiwa_admin", canWrite: true };
  state.saved = []; state.revalidated = []; state.saveThrows = null;
});

describe("saveFxRateAction", () => {
  it("saves a valid rate for an administrator and refreshes the settings and portfolio pages", async () => {
    expect(await run(good)).toEqual({ ok: true });
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0][1]).toEqual({ currency: "EUR", rate: 0.8512, source: "ECB euro reference rate", asOf: "2026-10-03" });
    expect(state.revalidated).toEqual(["/admin/settings", "/portfolio"]);
  });

  it("refuses staff who are not administrators, even ones who can write, before anything else", async () => {
    for (const role of ["org_user", "investor_viewer"]) {
      state.session.role = role;
      state.session.canWrite = role !== "investor_viewer";
      expect(await run(good)).toEqual({ error: "Only a Reiwa administrator can change exchange rates." });
    }
    expect(state.saved).toEqual([]);
  });

  it("refuses an update with no source, and writes nothing", async () => {
    const r = await run({ ...good, source: "   " });
    expect(r).toMatchObject({ error: expect.stringContaining("a source is required") });
    expect(await run({ currency: "EUR", rate: "0.85", asOf: "2026-10-03" })).toMatchObject({ error: expect.stringContaining("a source is required") });
    expect(state.saved).toEqual([]);
  });

  it("refuses the demo label as a source", async () => {
    expect(await run({ ...good, source: "Demo static rates" })).toMatchObject({ error: expect.stringContaining("placeholder") });
    expect(state.saved).toEqual([]);
  });

  it("uses the server's date, not the browser's: a future date is refused", async () => {
    expect(await run({ ...good, asOf: "2026-10-06" })).toMatchObject({ error: expect.stringContaining("future") });
    expect(state.saved).toEqual([]);
  });

  it("tolerates garbage rather than throwing", async () => {
    expect(await run(null)).toMatchObject({ error: expect.any(String) });
    expect(await run("x")).toMatchObject({ error: expect.any(String) });
    expect(state.saved).toEqual([]);
  });

  it("a database fault is not shown to the person as a rule message", async () => {
    state.saveThrows = Object.assign(new Error("connection reset"), { code: "08006" });
    await expect(run(good)).rejects.toThrow("connection reset");
  });
});
