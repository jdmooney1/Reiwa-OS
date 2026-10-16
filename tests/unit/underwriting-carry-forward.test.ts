// A new underwriting version carries the structured assumptions (rent roll, teaser tenancy)
// of the version the form was seeded from, minus the teaser's "source" stamp: the new version
// is the person's. No database: the data layer is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ created: [] as unknown[][], versions: [] as unknown[] }));
vi.mock("@/lib/auth/session", () => ({
  requireDbSession: async () => ({ userId: "u1", orgIds: ["o1"], role: "reiwa_staff", canWrite: true }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/data/underwriting", () => ({
  createVersion: async (...a: unknown[]) => { state.created.push(a); return "case-2"; },
  makeCurrent: async () => undefined,
  listVersions: async () => state.versions,
}));

const OPP = "11111111-1111-4111-8111-111111111111";
const run = async () => {
  const fd = new FormData();
  fd.set("changeRationale", "Underwritten");
  return (await import("@/app/actions/workspace")).createVersionAction(OPP, { ok: false } as never, fd);
};
const written = () => state.created[0][2] as Record<string, unknown>;
beforeEach(() => { state.created = []; state.versions = []; });

describe("new version: assumptions carry forward", () => {
  it("from the working version, without the teaser's source stamp", async () => {
    state.versions = [
      { version: 2, status: "draft", assumptions: { other: 1 } },
      { version: 1, status: "current", assumptions: { source: "teaser_intake", rentRoll: [{ unit: "G" }], teaserFile: "t.pdf" } },
    ];
    expect((await run()).error).toBeUndefined();
    expect(written().assumptions).toEqual({ rentRoll: [{ unit: "G" }], teaserFile: "t.pdf" });
  });
  it("from the approved version when nothing is working", async () => {
    state.versions = [{ version: 1, status: "approved", assumptions: { rentRoll: [] } }];
    await run();
    expect(written().assumptions).toEqual({ rentRoll: [] });
  });
  it("sets nothing when there is nothing to carry", async () => {
    state.versions = [{ version: 1, status: "current", assumptions: {} }];
    await run();
    expect("assumptions" in written()).toBe(false);
  });
});
