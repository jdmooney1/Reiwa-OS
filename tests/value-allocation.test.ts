// ============================================================================
// Land / building value and the depreciation basis (migration 0027), against real
// Postgres: the reconciliation rule lives in the database, the figures are
// immutable once approved, and the Snapshot shows them only once entered.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion, getVersion } from "@/lib/data/underwriting";
import { recordDecision } from "@/lib/data/ic-decisions";
import { loadMemoSource } from "@/lib/data/memos";
import { composeMemo } from "@/lib/memo/compose";
import { orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

let session: Session;
let meiji: string;
let n = 0;

async function newCase(input: Parameters<typeof createVersion>[2] = { acquisitionPrice: 64_000_000 }, currency = "GBP") {
  const opp = await createOpportunity(session, {
    orgId: meiji, name: `Alloc ${++n}`, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "value_add", currency, address: `${300 + n} Test Street`,
  });
  const caseId = await createVersion(session, opp, input);
  return { opp, caseId };
}
const set = (caseId: string, sql: string, params: unknown[] = []) =>
  adminQuery(`update investment_cases set ${sql} where case_id = $1`, [caseId, ...params]);

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  session = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
});

describe("the four inputs", () => {
  it("are stored on the case, and read back through the data layer", async () => {
    const { caseId } = await newCase({
      acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000,
      depreciationYears: 40, depreciationMethod: "straight_line",
    });
    const v = (await getVersion(session, caseId))!;
    expect(v).toMatchObject({ landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line" });
  });

  it("are all null on a case that has none: nothing is defaulted or backfilled", async () => {
    const { caseId } = await newCase();
    expect(await getVersion(session, caseId)).toMatchObject({ landValue: null, buildingValue: null, depreciationYears: null, depreciationMethod: null });
  });

  it("are the only new columns: no derived percentage or yen figure is stored", async () => {
    const cols = (await adminQuery<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'investment_cases'
        and column_name ~ 'land|building|depreciation|annual|jpy|yen|pct_of'`)).map((c) => c.column_name).sort();
    expect(cols).toEqual(["building_value", "depreciation_method", "depreciation_years", "land_value"]);
  });
});

describe("the database refuses a split that does not add up", () => {
  it("accepts one that adds up exactly, and one within 0.5% of the price", async () => {
    const { caseId } = await newCase();
    await set(caseId, "land_value = 30000000, building_value = 34000000");
    await set(caseId, "land_value = 30000000, building_value = 34300000");
  });

  it("refuses one beyond 0.5%, over or short", async () => {
    const { caseId } = await newCase();
    await expect(set(caseId, "land_value = 30000000, building_value = 34400000")).rejects.toThrow(/investment_cases_allocation_reconciles/);
    await expect(set(caseId, "land_value = 30000000, building_value = 20000000")).rejects.toThrow(/investment_cases_allocation_reconciles/);
  });

  it("refuses both halves when there is no price to reconcile against", async () => {
    const { caseId } = await newCase({});
    await expect(set(caseId, "land_value = 30000000, building_value = 34000000")).rejects.toThrow(/investment_cases_allocation_reconciles/);
  });

  it("refuses to change the price out from under an existing split", async () => {
    const { caseId } = await newCase({ acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000 });
    await expect(set(caseId, "acquisition_price = 80000000")).rejects.toThrow(/investment_cases_allocation_reconciles/);
  });

  it("allows one half on its own: nothing is claimed until both are entered", async () => {
    const { caseId } = await newCase();
    await set(caseId, "land_value = 30000000");
  });

  it("refuses a negative value", async () => {
    const { caseId } = await newCase();
    await expect(set(caseId, "land_value = -1")).rejects.toThrow(/investment_cases_allocation_nonneg/);
    await expect(set(caseId, "building_value = -1")).rejects.toThrow(/investment_cases_allocation_nonneg/);
  });
});

describe("the depreciation assumption", () => {
  it("is a whole number of years from 1 to 100, straight-line only, and the two move together", async () => {
    const { caseId } = await newCase();
    await set(caseId, "depreciation_years = 47, depreciation_method = 'straight_line'");
    await expect(set(caseId, "depreciation_years = 0")).rejects.toThrow();
    await expect(set(caseId, "depreciation_years = 101, depreciation_method = 'straight_line'")).rejects.toThrow(/investment_cases_depreciation_life/);
    await expect(set(caseId, "depreciation_years = 30, depreciation_method = 'declining_balance'")).rejects.toThrow(/investment_cases_depreciation_method/);
    await expect(set(caseId, "depreciation_years = null")).rejects.toThrow(/investment_cases_depreciation_whole/);
    await expect(set(caseId, "depreciation_method = null")).rejects.toThrow(/investment_cases_depreciation_whole/);
    await set(caseId, "depreciation_years = null, depreciation_method = null");
  });
});

describe("once the committee approves, the figures are locked with the rest of the case", () => {
  it.each([
    ["land_value", "29000000"], ["building_value", "35000000"], ["depreciation_years", "30"], ["depreciation_method", "null"],
  ])("a direct update of %s on an approved case is refused", async (col, value) => {
    const { opp, caseId } = await newCase({
      acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line",
    });
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await expect(set(caseId, `${col} = ${value}`)).rejects.toThrow(/immutable/);
  });

  it("the next version starts from nothing and can carry a new split without touching the approved one", async () => {
    const { opp, caseId } = await newCase({
      acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line",
    });
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    const v2 = await createVersion(session, opp, { acquisitionPrice: 70_000_000, landValue: 30_000_000, buildingValue: 40_000_000, depreciationYears: 35, depreciationMethod: "straight_line" });
    expect((await getVersion(session, caseId))!.buildingValue).toBe(34_000_000);
    expect((await getVersion(session, v2))!.buildingValue).toBe(40_000_000);
  });
});

describe("the Asset Snapshot", () => {
  beforeAll(async () => {
    await adminQuery("update fx_rates set rate_to_gbp = 0.0052, as_of_date = current_date, source = 'ECB reference rate (auto)' where currency = 'JPY'");
  });

  it("shows the allocation and the depreciation line once entered, with derived GBP and JPY figures", async () => {
    const { opp } = await newCase({
      acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line",
    });
    const a = composeMemo((await loadMemoSource(session, opp))!).snapshot!.allocation!;
    expect(a.buildingPct).toBeCloseTo(53.125, 6);
    expect(a.depreciation).toMatchObject({ years: 40, annual: 850_000 });
    expect(a.depreciation!.annualJpy).toBeCloseTo(850_000 / 0.0052, 0);
    expect(a.landJpy).toBeCloseTo(30_000_000 / 0.0052, 0);
  });

  it("follows the life assumption when a new version changes it: nothing derived is kept", async () => {
    const { opp } = await newCase({ acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line" });
    await createVersion(session, opp, { acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 20, depreciationMethod: "straight_line" });
    expect(composeMemo((await loadMemoSource(session, opp))!).snapshot!.allocation!.depreciation!.annual).toBe(1_700_000);
  });

  it("follows the exchange rate: the yen figure is computed from whatever is stored when it is composed", async () => {
    const { opp } = await newCase({ acquisitionPrice: 64_000_000, landValue: 30_000_000, buildingValue: 34_000_000, depreciationYears: 40, depreciationMethod: "straight_line" });
    await adminQuery("update fx_rates set rate_to_gbp = 0.0050 where currency = 'JPY'");
    expect(composeMemo((await loadMemoSource(session, opp))!).snapshot!.allocation!.depreciation!.annualJpy).toBeCloseTo(850_000 / 0.005, 0);
    await adminQuery("update fx_rates set rate_to_gbp = 0.0052 where currency = 'JPY'");
  });

  it("is cleanly absent before anything is entered", async () => {
    const { opp } = await newCase();
    const s = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
    expect(s.allocation).toBeNull();
    expect(s.gaps.find((g) => g.key === "value_allocation")).toBeTruthy();
  });
});
