// ============================================================================
// The pipeline LIST does not carry location data to the browser.
// ----------------------------------------------------------------------------
// The pipeline page hands its rows to a client component, and a client
// component's props are serialised into the page: whatever is on a row is
// delivered to the browser, displayed or not. The page never shows a coordinate,
// a formatted address, a geocode's status or age, or the street-view flag, so
// listPipeline() strips them (and PipelineRow is typed without them). The
// opportunity WORKSPACE, which draws the map and the photo, keeps them.
//
// No database: listPipeline() runs against mocked reads.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCATION_FIELDS, withoutLocation, type Opportunity } from "@/lib/data/opportunity-types";

const full = (over: Partial<Opportunity> = {}): Opportunity => ({
  opportunityId: "o1", orgId: "org", propertyId: "p1", name: "24-26 Spring Street", market: "London",
  submarket: "Paddington", assetType: "office", strategy: "core", stage: "new", status: "active",
  documentStage: 0,
  currency: "GBP", targetPrice: null, niy: null, reversionaryYield: null, passingRent: null, erv: null,
  capexBudget: null, targetIrr: null, equityMultiple: null, probability: null, source: null,
  sourceType: "other", sourceContactName: null, sourceContactEmail: null, sourcedAt: null,
  referralNote: null, brokerName: "Knight Frank", vendorName: null, priority: "medium",
  triageStatus: "live", triagePriority: "P1", triageNote: "Strong income", ownerUserId: null,
  ownerName: null, nextMilestone: null, nextMilestoneDate: null, lastMaterialUpdateAt: null,
  sizeSqft: null, sizeSqm: null, summary: null, address: "24-26 Spring Street", city: "London",
  country: "United Kingdom",
  latitude: 51.5158, longitude: -0.1755, geocodeStatus: "ok", formattedAddress: "24-26 Spring St, London W2 1JA, UK",
  geocodedAt: "2026-09-29T10:00:00.000Z", hasStreetView: true,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", archivedAt: null, assetId: null,
  ...over,
});

describe("withoutLocation", () => {
  it("removes exactly the six location-derived fields", () => {
    expect([...LOCATION_FIELDS].sort()).toEqual(
      ["formattedAddress", "geocodeStatus", "geocodedAt", "hasStreetView", "latitude", "longitude"]);
    const before = Object.keys(full());
    const after = Object.keys(withoutLocation(full()));
    expect(before.filter((k) => !after.includes(k)).sort()).toEqual([...LOCATION_FIELDS].sort());
  });

  it("keeps every other field, unchanged", () => {
    const o = full();
    const stripped = withoutLocation(o) as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if ((LOCATION_FIELDS as readonly string[]).includes(k)) continue;
      expect(stripped[k], k).toEqual(v);
    }
  });

  it("does not mutate the original, which the workspace still needs", () => {
    const o = full();
    withoutLocation(o);
    expect(o.latitude).toBe(51.5158);
    expect(o.hasStreetView).toBe(true);
  });

  it("keeps the broker's own address: the filter's search uses it, and it is not Google-derived", () => {
    expect((withoutLocation(full()) as Record<string, unknown>).address).toBe("24-26 Spring Street");
  });
});

describe("listPipeline's payload", () => {
  vi.mock("@/lib/db/client", () => ({
    withSession: async (_s: unknown, fn: (tx: { query: () => Promise<{ rows: unknown[] }> }) => unknown) =>
      fn({ query: async () => ({ rows: [{
        opportunity_id: "o1", version: 2, status: "current", acquisition_price: "12000000",
        total_cost: "13000000", entry_yield_pct: "5.1", target_irr: "11", target_equity_multiple: "1.6",
      }] }) }),
  }));
  vi.mock("@/lib/data/opportunities", () => ({
    listOpportunitiesOn: async () => [
      // Carries every location field, as the shared query returns it.
      { ...(await import("./pipeline-payload.fixture")).row() },
    ],
    getOpportunity: async () => null,
  }));

  it("contains no location field anywhere in what would be serialised to the browser", async () => {
    const { listPipeline } = await import("@/lib/data/opportunity-file");
    const rows = await listPipeline({ userId: "u", orgIds: [], role: "reiwa_admin", canWrite: true });
    expect(rows).toHaveLength(1);
    const wire = JSON.stringify(rows);
    for (const key of LOCATION_FIELDS) expect(wire, key).not.toContain(`"${key}"`);
    // ...and not the values either, in case a field were renamed.
    expect(wire).not.toContain("51.5158");
    expect(wire).not.toContain("-0.1755");
    expect(wire).not.toContain("W2 1JA");
  });

  it("still carries everything the pipeline page and its filter actually read", async () => {
    const { listPipeline } = await import("@/lib/data/opportunity-file");
    const [row] = await listPipeline({ userId: "u", orgIds: [], role: "reiwa_admin", canWrite: true });
    const needed = [
      // the board card and table (opportunity-pipeline.tsx)
      "opportunityId", "name", "city", "assetType", "strategy", "stage", "status", "currency",
      "triageStatus", "triagePriority", "triageNote",
      "caseBasis", "caseVersion", "caseAcquisitionPrice", "caseTotalCost", "caseEntryYieldPct", "caseTargetIrr", "headlinePhotoId",
      // the filter and search (src/lib/pipeline/filter.ts)
      "address", "brokerName", "market",
    ];
    for (const k of needed) expect(Object.keys(row), k).toContain(k);
    expect(row.caseAcquisitionPrice).toBe(12_000_000);
    expect(row.triageStatus).toBe("live");
  });
});

describe("what the pipeline page may read, and what the workspace still reads", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const LOC = /latitude|longitude|formattedAddress|geocodeStatus|geocodedAt|hasStreetView|LOCATION_FIELDS/;

  it.each([
    "src/app/(app)/pipeline/page.tsx",
    "src/components/opportunities/opportunity-pipeline.tsx",
    "src/lib/pipeline/filter.ts",
  ])("%s never reads a location field", (file) => {
    expect(read(file)).not.toMatch(LOC);
  });

  it("only listPipeline strips: the shared opportunity read and the workspace path are untouched", () => {
    const file = read("src/lib/data/opportunity-file.ts");
    expect(file.match(/withoutLocation\(/g)).toHaveLength(1);
    const listPipeline = file.slice(file.indexOf("export async function listPipeline"));
    expect(listPipeline).toContain("withoutLocation(o)");
    // getOpportunityFile (the workspace) does not go through it
    const workspace = file.slice(file.indexOf("export async function getOpportunityFile"), file.indexOf("export interface PipelineRow"));
    expect(workspace).not.toContain("withoutLocation");
  });

  it("the workspace summary still reads the location through the opportunity", () => {
    expect(read("src/components/workspace/summary-section.tsx")).toContain("mapStateFor(o,");
    expect(read("src/components/workspace/summary-section.tsx")).toContain("o.hasStreetView");
  });
});
