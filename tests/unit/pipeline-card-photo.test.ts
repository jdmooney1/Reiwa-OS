// ============================================================================
// The headline photograph shows on the Pipeline BOARD card and nowhere else in
// the pipeline: the table view stays text-only.
// ============================================================================
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OpportunityPipeline } from "@/components/opportunities/opportunity-pipeline";
import type { PipelineRow } from "@/lib/data/opportunity-file";

const row = (id: string, headlinePhotoId: string | null): PipelineRow => ({
  opportunityId: id, orgId: "org", propertyId: "p-" + id, name: `Asset ${id}`, market: "London",
  submarket: null, assetType: "office", strategy: "core", stage: "new", status: "active", currency: "GBP",
  targetPrice: null, niy: null, reversionaryYield: null, passingRent: null, erv: null, capexBudget: null,
  targetIrr: null, equityMultiple: null, probability: null, source: null, sourceType: "other",
  sourceContactName: null, sourceContactEmail: null, sourcedAt: null, referralNote: null, brokerName: null,
  vendorName: null, priority: "medium", triageStatus: "live", triagePriority: null, triageNote: null,
  ownerUserId: null, ownerName: null, nextMilestone: null, nextMilestoneDate: null, lastMaterialUpdateAt: null,
  sizeSqft: null, sizeSqm: null, summary: null, address: null, city: "London", country: "United Kingdom",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", archivedAt: null, assetId: null,
  caseBasis: "none", caseVersion: null, caseAcquisitionPrice: null, caseTotalCost: null,
  caseEntryYieldPct: null, caseTargetIrr: null, caseEquityMultiple: null, headlinePhotoId,
} as PipelineRow);

const PHOTO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("board card", () => {
  const html = renderToStaticMarkup(createElement(OpportunityPipeline, {
    opportunities: [row("1", PHOTO), row("2", null)],
  }));

  it("shows the headline photograph through the delivery route, by id", () => {
    expect(html).toContain(`src="/api/asset-photos/${PHOTO}"`);
    expect(html.match(/\/api\/asset-photos\//g)).toHaveLength(1);
  });

  it("loads it lazily, and a card without one renders no image at all", () => {
    expect(html).toContain('loading="lazy"');
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it("never puts a storage path or bucket in the page", () => {
    expect(html).not.toMatch(/property-photos|object_path|supabase\.co|signed/i);
  });
});

describe("table view stays text-only", () => {
  const src = readFileSync(join(process.cwd(), "src/components/opportunities/opportunity-pipeline.tsx"), "utf8");
  const table = src.slice(src.indexOf("function OppTable"));

  it("OppTable renders no image and never reads the photo id", () => {
    expect(table).not.toMatch(/<img|headlinePhotoId|asset-photos/);
  });

  it("the only use of the photo in the file is the board card", () => {
    expect(src.match(/headlinePhotoId/g)).toHaveLength(2); // the guard and the src
  });
});
