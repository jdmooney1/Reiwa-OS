// ============================================================================
// saveScoreAction: gated, validated, and computed on the server.
// ----------------------------------------------------------------------------
// The twin of what createVersionAction does for underwriting. No database: the
// session and the data layer are mocked, so what is asserted is the ORDER of the
// checks and that nothing the browser says about the overall reaches the write.
// The same rules against real RLS are in tests/investment-scores.test.ts.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  session: { userId: "u1", orgIds: ["o1"], role: "org_user", canWrite: true } as Record<string, unknown>,
  saved: [] as unknown[][],
  revalidated: [] as string[],
  saveThrows: null as Error | null,
}));

vi.mock("@/lib/auth/session", () => ({ requireDbSession: async () => state.session }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));
vi.mock("@/lib/data/scores", () => ({
  saveScore: async (...args: unknown[]) => { if (state.saveThrows) throw state.saveThrows; state.saved.push(args); return "score-1"; },
}));

const OPP = "11111111-1111-4111-8111-111111111111";
const good = [{ key: "location_quality", score: 8, commentary: "Prime", riskFlag: false }];

beforeEach(() => {
  state.session = { userId: "u1", orgIds: ["o1"], role: "org_user", canWrite: true };
  state.saved = []; state.revalidated = []; state.saveThrows = null;
});

const run = async (opp: string, body: unknown) => (await import("@/app/actions/score")).saveScoreAction(opp, body);

describe("saveScoreAction", () => {
  it("records a valid score for a writer, and refreshes the score and memo pages", async () => {
    expect(await run(OPP, good)).toEqual({ ok: true });
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0][1]).toBe(OPP);
    expect(state.saved[0][2]).toEqual([{ key: "location_quality", score: 8, commentary: "Prime", riskFlag: false }]);
    expect(state.revalidated).toEqual([`/opportunities/${OPP}/score`, `/opportunities/${OPP}/memo`]);
  });

  it("is refused for a session that cannot write, before anything is validated or written", async () => {
    state.session.canWrite = false;
    const r = await run(OPP, good);
    expect(r).toEqual({ error: "You do not have permission to record a score." });
    expect(state.saved).toEqual([]);
  });

  it("refuses an opportunity id that is not a uuid", async () => {
    expect(await run("../etc", good)).toEqual({ error: "That opportunity could not be found." });
    expect(state.saved).toEqual([]);
  });

  it("returns the validation message to the person and writes nothing", async () => {
    expect(await run(OPP, [{ key: "capex_risk", score: 4, commentary: "", riskFlag: true }])).toEqual({ error: "Capex Risk: say why it is flagged." });
    expect(await run(OPP, [{ key: "location_quality", score: 12 }])).toMatchObject({ error: expect.stringContaining("half points") });
    expect(await run(OPP, "garbage")).toMatchObject({ error: expect.any(String) });
    expect(state.saved).toEqual([]);
  });

  it("passes the data layer ONLY the validated categories: an overall or recommendation sent by the browser is dropped", async () => {
    await run(OPP, [{ ...good[0], overall: 100, recommendation: "strong_proceed", weights: { location_quality: 999 } }]);
    expect(state.saved[0][2]).toEqual([{ key: "location_quality", score: 8, commentary: "Prime", riskFlag: false }]);
  });

  it("a database rule refusal that the person can act on comes back as a message; a fault still throws", async () => {
    state.saveThrows = Object.assign(new Error("boom"), { code: "P0001" });
    expect(await run(OPP, good)).toEqual({ error: "This score could not be recorded." });
    state.saveThrows = new Error("connection reset");
    await expect(run(OPP, good)).rejects.toThrow("connection reset");
  });
});
