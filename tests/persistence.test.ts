import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, adminQuery, type Session } from "@/lib/db/client";
import { authenticate } from "@/lib/auth/service";
import { createOpportunity, getOpportunity, setStage } from "@/lib/data/opportunities";
import { convertToAsset } from "@/lib/data/conversion";

// Simulate "server restart" by closing the file-backed singleton and reopening
// the SAME data directory in a new PGlite instance.
async function restart(): Promise<void> {
  const g = globalThis as unknown as { __reiwa_db?: Promise<unknown> };
  const cur = g.__reiwa_db;
  if (cur) { try { await (await cur as { close(): Promise<void> }).close(); } catch { /* ignore */ } }
  g.__reiwa_db = undefined;
}

describe("File persistence across server restart", () => {
  it("retains created + converted records after the DB process restarts", async () => {
    process.env.PGLITE_DATA_DIR = join(tmpdir(), `reiwa-persist-${Date.now()}`);

    // Boot #1 — migrates + seeds to disk, then create & convert.
    await getDb();
    const auth = await authenticate("analyst@meiji.com", "reiwa2026");
    expect(auth).not.toBeNull();
    const session: Session = { userId: auth!.userId, orgIds: auth!.orgIds, role: auth!.role, canWrite: true };

    const id = await createOpportunity(session, {
      orgId: auth!.orgIds[0], name: "20 Example Street", city: "London", market: "London",
      assetType: "office", currency: "GBP", targetPrice: 30000000, targetIrr: 15,
    });
    for (const s of ["screening", "underwriting", "ic", "approved"] as const) await setStage(session, id, s);
    const { assetId } = await convertToAsset(session, id, { acquisitionDate: "2026-08-27", equityInvested: 15000000, debt: 15000000 });

    // "Restart"
    await restart();

    // Boot #2 — reopen same dir (seed must NOT re-run).
    await getDb();
    const orgs = await adminQuery<{ n: number }>("select count(*)::int as n from organizations");
    expect(orgs[0].n).toBe(2); // seed did not duplicate

    const opp = await getOpportunity(session, id);
    expect(opp).not.toBeNull();
    expect(opp!.name).toBe("20 Example Street");
    expect(opp!.status).toBe("converted");
    expect(opp!.assetId).toBe(assetId);

    await restart();
    delete process.env.PGLITE_DATA_DIR;
  });
});
