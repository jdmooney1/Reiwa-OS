import { describe, it, expect } from "vitest";
import { adminQuery, closePool, type Session } from "@/lib/db/client";
import { authenticate } from "@/lib/auth/service";
import { canWrite } from "@/lib/auth/session";
import { createOpportunity, getOpportunity, setStage } from "@/lib/data/opportunities";
import { convertToAsset } from "@/lib/data/conversion";
import { DEMO_PASSWORD } from "@/lib/db/seed";

/**
 * Simulate a server restart: drop every pooled connection and let the next call
 * open fresh ones. The data lives in hosted Supabase Postgres, so it must be
 * unaffected.
 */
async function restart(): Promise<void> {
  await closePool();
}

describe("Supabase Auth sign-in", () => {
  it("accepts a seeded staff account and rejects a wrong password", async () => {
    const auth = await authenticate("analyst@meiji.com", DEMO_PASSWORD);
    expect(auth).not.toBeNull();
    expect(auth!.email).toBe("analyst@meiji.com");
    expect(auth!.role).toBe("org_user");
    expect(auth!.orgIds.length).toBe(1);

    expect(await authenticate("analyst@meiji.com", "not-the-password")).toBeNull();
    expect(await authenticate("nobody@example.com", DEMO_PASSWORD)).toBeNull();
  });

  it("carries the role's write scope", async () => {
    const viewer = await authenticate("viewer@meiji.com", DEMO_PASSWORD);
    expect(viewer!.role).toBe("investor_viewer");
    expect(canWrite(viewer!.role)).toBe(false);

    const admin = await authenticate("admin@reiwa.com", DEMO_PASSWORD);
    expect(admin!.role).toBe("reiwa_admin");
    expect(canWrite(admin!.role)).toBe(true);
  });
});

describe("Persistence across a server restart", () => {
  it("retains created + converted records after the connection pool is recycled", async () => {
    const auth = await authenticate("analyst@meiji.com", DEMO_PASSWORD);
    expect(auth).not.toBeNull();
    const session: Session = {
      userId: auth!.userId, orgIds: auth!.orgIds, role: auth!.role, canWrite: true,
    };

    const id = await createOpportunity(session, {
      orgId: auth!.orgIds[0], name: "Restart Probe House", city: "London", market: "London",
      assetType: "office", currency: "GBP", targetPrice: 30000000, targetIrr: 15,
    });
    for (const s of ["screening", "underwriting", "ic", "approved"] as const) await setStage(session, id, s);
    const { assetId } = await convertToAsset(session, id, {
      acquisitionDate: "2026-08-27", equityInvested: 15000000, debt: 15000000,
    });

    await restart();

    // Fresh connections — the records and the seed are exactly as they were.
    const orgs = await adminQuery<{ n: number }>("select count(*)::int as n from organizations");
    expect(orgs[0].n).toBe(2); // seed did not duplicate

    const opp = await getOpportunity(session, id);
    expect(opp).not.toBeNull();
    expect(opp!.name).toBe("Restart Probe House");
    expect(opp!.status).toBe("converted");
    expect(opp!.assetId).toBe(assetId);
  });
});
