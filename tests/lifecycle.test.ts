import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { adminQueryOn, type Queryable, type Session } from "@/lib/db/client";
import {
  createOpportunity, getOpportunity, listOpportunities, setStage,
} from "@/lib/data/opportunities";
import { convertToAsset } from "@/lib/data/conversion";
import { getAssetFile, listAssetFiles, addPerformancePeriod } from "@/lib/data/assets";
import { getPortfolioData } from "@/lib/data/portfolio";
import { threeWay, variance, varianceTone } from "@/lib/asset-intelligence/metrics";
import { freshDb, installTestDb, clearTestDb, orgIdByName, sessionFor } from "./helpers";

let db: PGlite;
let meiji: string;
let session: Session;

beforeAll(async () => {
  db = await freshDb();
  installTestDb(db);
  meiji = await orgIdByName(db, "Meiji Shipping");
  session = await sessionFor(db, "analyst@meiji.com");
});
afterAll(async () => { clearTestDb(); await db.close(); });

describe("Opportunity persistence", () => {
  it("creates, reads back, and lists an opportunity", async () => {
    const id = await createOpportunity(session, {
      orgId: meiji, name: "20 Example Street", city: "London", country: "United Kingdom",
      market: "London", assetType: "office", strategy: "value_add", currency: "GBP",
      targetPrice: 25000000, targetIrr: 15, niy: 5.0,
    });
    const opp = await getOpportunity(session, id);
    expect(opp).not.toBeNull();
    expect(opp!.name).toBe("20 Example Street");
    expect(opp!.stage).toBe("new");
    expect(opp!.targetPrice).toBe(25000000);
    expect(opp!.propertyId).not.toBeNull(); // a neutral property was created

    const all = await listOpportunities(session);
    expect(all.some((o) => o.opportunityId === id)).toBe(true);
  });
});

describe("Opportunity → Asset conversion", () => {
  it("progresses stages, converts, and preserves the underwriting baseline", async () => {
    const id = await createOpportunity(session, {
      orgId: meiji, name: "Conversion Test House", city: "London", market: "London",
      assetType: "office", currency: "GBP", targetPrice: 40000000, targetIrr: 13,
      capexBudget: 2000000, summary: "Test thesis.",
    });
    for (const s of ["screening", "underwriting", "ic", "approved"] as const) {
      await setStage(session, id, s);
    }
    const { assetId, alreadyExisted } = await convertToAsset(session, id, {
      acquisitionDate: "2026-08-27", equityInvested: 20000000, debt: 20000000,
    });
    expect(alreadyExisted).toBe(false);

    const opp = await getOpportunity(session, id);
    expect(opp!.stage).toBe("acquired");
    expect(opp!.status).toBe("converted");
    expect(opp!.assetId).toBe(assetId);

    const file = await getAssetFile(session, assetId);
    expect(file).not.toBeNull();
    const uw = file!.plans.find((p) => p.plan_type === "underwriting");
    expect(uw).toBeTruthy();
    expect(uw!.irr_pct).toBe(13); // carried from approved case (target_irr)
    expect(file!.asset.source_deal_id).toBe(id); // asset references its opportunity

    // Idempotent: a second conversion returns the same asset.
    const again = await convertToAsset(session, id);
    expect(again.assetId).toBe(assetId);
    expect(again.alreadyExisted).toBe(true);
  });
});

describe("Original underwriting is immutable", () => {
  it("blocks updates to the underwriting business plan and the approved case", async () => {
    const q = (sql: string, p: unknown[] = []) => adminQueryOn(db as unknown as Queryable, sql, p);
    await expect(q("update business_plans set noi = 1 where plan_type = 'underwriting'"))
      .rejects.toThrow(/immutable/i);
    await expect(q("update investment_cases set acquisition_price = 1 where status = 'approved'"))
      .rejects.toThrow(/immutable/i);
    await expect(q("delete from transactions"))
      .rejects.toThrow(/immutable/i);
  });
});

describe("Variance against underwriting", () => {
  it("computes forecast-vs-underwriting variance from stored data", async () => {
    const files = await listAssetFiles(session);
    const conduit = files.find((f) => f.asset.name === "16 Conduit Street")!;
    const tw = threeWay(conduit, "noi");
    expect(tw.underwriting).toBeGreaterThan(0);
    expect(tw.forecast).toBeGreaterThan(0);
    const v = variance(tw.forecast, tw.underwriting);
    expect(v.abs).toBeLessThan(0); // demo: forecast NOI below underwriting
    expect(varianceTone("noi", v)).toBe("negative");
  });
});

describe("Portfolio aggregates from stored assets", () => {
  it("changing one asset's actual NOI changes the portfolio total", async () => {
    const before = await getPortfolioData(session);
    const conduit = (await listAssetFiles(session)).find((f) => f.asset.name === "16 Conduit Street")!;

    await addPerformancePeriod(session, conduit.asset.asset_id, {
      periodLabel: "Q3 2026", periodEnd: "2026-09-30", noi: 2200000, occupancyPct: 88, valuation: 59500000, debt: 29000000,
    });

    const after = await getPortfolioData(session);
    expect(after.aggregate.noi).not.toBe(before.aggregate.noi);
    expect(after.aggregate.noi!).toBeGreaterThan(before.aggregate.noi!); // higher latest NOI lifts the total
    // FX is explicit + labelled (not silently hard-coded).
    expect(after.fx.source).toMatch(/rates/i);
    expect(after.fx.asOf).toBeTruthy();
  });
});
