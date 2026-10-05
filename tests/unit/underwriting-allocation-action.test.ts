// ============================================================================
// createVersionAction and the value allocation: a whole-year life, a split that adds
// up, and the method set by the server. No database: the session and the data layer
// are mocked; what is asserted is what reaches the write.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ created: [] as unknown[][] }));

vi.mock("@/lib/auth/session", () => ({
  requireDbSession: async () => ({ userId: "u1", orgIds: ["o1"], role: "org_user", canWrite: true }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/data/underwriting", () => ({
  createVersion: async (...a: unknown[]) => { state.created.push(a); return "case-1"; },
  makeCurrent: async () => undefined,
}));

const OPP = "11111111-1111-4111-8111-111111111111";
const run = async (fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("changeRationale", "test");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (await import("@/app/actions/workspace")).createVersionAction(OPP, { ok: false } as never, fd);
};
const written = () => state.created[0][2] as Record<string, unknown>;

beforeEach(() => { state.created = []; });

describe("createVersionAction: value allocation", () => {
  const good = { acquisitionPrice: "64000000", landValue: "30000000", buildingValue: "34000000", depreciationYears: "40" };

  it("writes the four inputs, with the method set by the server (the browser is never asked for it)", async () => {
    expect(await run(good)).toEqual({ ok: true });
    expect(written()).toMatchObject({ landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line" });
  });

  it("ignores a method the browser sends: there is only one", async () => {
    await run({ ...good, depreciationMethod: "declining_balance" });
    expect(written().depreciationMethod).toBe("straight_line");
  });

  it("with no life there is no method either", async () => {
    await run({ ...good, depreciationYears: "" });
    expect(written()).toMatchObject({ depreciationYears: null, depreciationMethod: null });
  });

  it("with nothing entered writes none of the four", async () => {
    await run({ acquisitionPrice: "64000000" });
    expect(written()).toMatchObject({ landValue: null, buildingValue: null, depreciationYears: null, depreciationMethod: null });
  });

  it("refuses a split that does not add up, with the gap, and writes nothing", async () => {
    const r = await run({ ...good, buildingValue: "20000000" });
    expect(r).toEqual({ error: "Land value plus building value is 50,000,000, 14,000,000 short of the acquisition price of 64,000,000. The split must come within 0.5% of the price." });
    expect(state.created).toEqual([]);
  });

  it("refuses a split with no price to reconcile against", async () => {
    const r = await run({ landValue: "30000000", buildingValue: "34000000" });
    expect(r).toMatchObject({ error: expect.stringContaining("Enter the acquisition price too") });
    expect(state.created).toEqual([]);
  });

  it("accepts a split within the tolerance", async () => {
    expect(await run({ ...good, buildingValue: "34200000" })).toEqual({ ok: true });
  });

  it("refuses a life that is not a whole number of years in range, or a negative value", async () => {
    for (const bad of [{ depreciationYears: "12.5" }, { depreciationYears: "0" }, { depreciationYears: "101" }, { depreciationYears: "forty" }, { landValue: "-1" }]) {
      const r = await run({ ...good, ...bad });
      expect(r, JSON.stringify(bad)).toMatchObject({ error: expect.any(String) });
    }
    expect(state.created).toEqual([]);
  });
});
