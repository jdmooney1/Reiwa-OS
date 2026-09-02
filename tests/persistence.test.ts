import { describe, it, expect } from "vitest";
import { getDb, adminQuery, type Session, type Db, type GlobalRole } from "@/lib/db/client";
import { createOpportunity, getOpportunity, setStage } from "@/lib/data/opportunities";
import { convertToAsset } from "@/lib/data/conversion";
import { createEmptyDatabase } from "./helpers";

// Simulate "server restart" by closing the pooled singleton and reconnecting
// to the SAME database — records must come back from Postgres, not memory.
async function restart(): Promise<void> {
  const g = globalThis as unknown as { __reiwa_db?: Promise<Db> };
  const cur = g.__reiwa_db;
  if (cur) { try { await (await cur).close(); } catch { /* ignore */ } }
  g.__reiwa_db = undefined;
}

describe("Persistence across server restart", () => {
  it("retains created + converted records after the DB connections restart", async () => {
    const target = await createEmptyDatabase();
    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = target.url;
    try {
      // Boot #1 — migrates + seeds, then create & convert as the analyst.
      await getDb();
      const analyst = (await adminQuery<{ user_id: string; global_role: GlobalRole }>(
        "select user_id, global_role from users where email = 'analyst@meiji.com'"))[0];
      expect(analyst).toBeTruthy();
      const orgs = await adminQuery<{ org_id: string }>(
        "select org_id from organization_members where user_id = $1", [analyst.user_id]);
      const session: Session = {
        userId: analyst.user_id, orgIds: orgs.map((o) => o.org_id), role: analyst.global_role, canWrite: true,
      };

      const id = await createOpportunity(session, {
        orgId: session.orgIds[0], name: "20 Example Street", city: "London", market: "London",
        assetType: "office", currency: "GBP", targetPrice: 30000000, targetIrr: 15,
      });
      for (const s of ["screening", "underwriting", "ic", "approved"] as const) await setStage(session, id, s);
      const { assetId } = await convertToAsset(session, id, { acquisitionDate: "2026-08-27", equityInvested: 15000000, debt: 15000000 });

      // "Restart"
      await restart();

      // Boot #2 — reconnect to the same database (seed must NOT re-run).
      await getDb();
      const orgCount = await adminQuery<{ n: number }>("select count(*)::int as n from organizations");
      expect(orgCount[0].n).toBe(2); // seed did not duplicate

      const opp = await getOpportunity(session, id);
      expect(opp).not.toBeNull();
      expect(opp!.name).toBe("20 Example Street");
      expect(opp!.status).toBe("converted");
      expect(opp!.assetId).toBe(assetId);
    } finally {
      await restart();
      process.env.DATABASE_URL = prevUrl;
      await target.drop();
    }
  });
});
