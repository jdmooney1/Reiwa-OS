import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createOpportunity } from "@/lib/data/opportunities";
import {
  freshDb, installTestDb, clearTestDb, orgIdByName, viewerSession, analystSession, type TestDb,
} from "./helpers";

let db: TestDb;
let meiji: string;
let aoyama: string;

beforeAll(async () => {
  db = await freshDb();
  installTestDb(db);
  meiji = await orgIdByName(db, "Meiji Shipping");
  aoyama = await orgIdByName(db, "Aoyama Holdings");
});
afterAll(async () => { clearTestDb(); await db.close(); });

describe("Write permissions & scope (database-enforced)", () => {
  it("investor_viewer cannot create (write blocked by RLS)", async () => {
    await expect(
      createOpportunity(await viewerSession(db), { orgId: meiji, name: "Viewer Attempt" }),
    ).rejects.toThrow();
  });

  it("a user cannot create an opportunity in an org they don't belong to", async () => {
    // Meiji user attempts to write into Aoyama's org — RLS check must fail.
    await expect(
      createOpportunity(await analystSession(db), { orgId: aoyama, name: "Cross-Org Attempt" }),
    ).rejects.toThrow();
  });

  it("an org_user can create within their own org", async () => {
    const id = await createOpportunity(await analystSession(db), { orgId: meiji, name: "Legit Opp" });
    expect(id).toBeTruthy();
  });
});
