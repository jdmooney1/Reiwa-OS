import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createOpportunity } from "@/lib/data/opportunities";
import { freshDb, installTestDb, clearTestDb, orgIdByName, sessionFor } from "./helpers";

let db: PGlite;
let meiji: string;
let aoyama: string;

beforeAll(async () => {
  db = await freshDb();
  installTestDb(db);
  meiji = await orgIdByName(db, "Meiji Shipping");
  aoyama = await orgIdByName(db, "Aoyama Holdings");
});
afterAll(async () => { clearTestDb(); await db.close(); });

describe("Write permissions & scope (database-enforced via membership roles)", () => {
  it("a viewer-role member cannot create (write blocked by RLS)", async () => {
    const viewer = await sessionFor(db, "viewer@meiji.com");
    expect(viewer.canWrite).toBe(false); // UI hint agrees with DB
    await expect(
      createOpportunity(viewer, { orgId: meiji, name: "Viewer Attempt" }),
    ).rejects.toThrow();
  });

  it("a user cannot create an opportunity in an org they don't belong to", async () => {
    const analyst = await sessionFor(db, "analyst@meiji.com");
    await expect(
      createOpportunity(analyst, { orgId: aoyama, name: "Cross-Org Attempt" }),
    ).rejects.toThrow();
  });

  it("a manager-role member can create within their own org", async () => {
    const analyst = await sessionFor(db, "analyst@meiji.com");
    const id = await createOpportunity(analyst, { orgId: meiji, name: "Legit Opp" });
    expect(id).toBeTruthy();
  });

  it("the session's canWrite flag cannot override the database (RLS re-derives)", async () => {
    // Forge canWrite=true on the read-only viewer: the DB must still block.
    const viewer = await sessionFor(db, "viewer@meiji.com");
    const forged = { ...viewer, canWrite: true };
    await expect(
      createOpportunity(forged, { orgId: meiji, name: "Forged Flag Attempt" }),
    ).rejects.toThrow();
  });
});
