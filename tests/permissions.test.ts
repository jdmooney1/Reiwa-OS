import { describe, it, expect, beforeAll } from "vitest";
import { createOpportunity } from "@/lib/data/opportunities";
import { orgIdByName, viewerSession, orgUserSession } from "./helpers";

let meiji: string;
let aoyama: string;

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  aoyama = await orgIdByName("Aoyama Holdings");
});

describe("Write permissions & scope (database-enforced)", () => {
  it("investor_viewer cannot create (write blocked by RLS)", async () => {
    await expect(
      createOpportunity(viewerSession([meiji]), { orgId: meiji, name: "Viewer Attempt" }),
    ).rejects.toThrow();
  });

  it("a user cannot create an opportunity in an org they don't belong to", async () => {
    // Meiji user attempts to write into Aoyama's org — RLS check must fail.
    await expect(
      createOpportunity(orgUserSession([meiji]), { orgId: aoyama, name: "Cross-Org Attempt" }),
    ).rejects.toThrow();
  });

  it("an org_user can create within their own org", async () => {
    const id = await createOpportunity(orgUserSession([meiji]), { orgId: meiji, name: "Legit Opp" });
    expect(id).toBeTruthy();
  });
});
