// ============================================================================
// Taking a deal off the pipeline - the reasons table and the rendered controls.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REMOVAL_REASONS, REMOVAL_REASON_ORDER, isRemovalReason, cleanNote, NOTE_MAX, REMOVABLE_FROM, RESTORABLE_FROM,
} from "@/lib/pipeline/removal";
import type { PipelineRow } from "@/lib/data/opportunity-file";
import { parseViewState } from "@/lib/pipeline/view-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/pipeline" }));
vi.mock("@/app/actions/triage", () => ({ triageDealAction: async () => ({}), undoTriageAction: async () => ({}) }));
vi.mock("@/app/actions/pipeline-views", () => ({ saveViewAction: async () => ({}), updateViewAction: async () => ({}), deleteViewAction: async () => ({}) }));
vi.mock("@/app/actions/removal", () => ({ removeDealAction: async () => ({}), restoreDealAction: async () => ({}) }));

import { OpportunityPipeline } from "@/components/opportunities/opportunity-pipeline";
import { RemoveDealButton, RestoreDealButton } from "@/components/opportunities/remove-deal";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("the four reasons", () => {
  it("offers sold, withdrawn, lost and passed, in that order", () => {
    expect(REMOVAL_REASON_ORDER).toEqual(["sold", "withdrawn", "lost", "passed"]);
    for (const id of REMOVAL_REASON_ORDER) expect(isRemovalReason(id)).toBe(true);
    for (const bad of ["", "SOLD", "converted", "active", "deleted", null, 4, undefined]) expect(isRemovalReason(bad), String(bad)).toBe(false);
  });

  it("Sold means no longer available, so it is stored as Withdrawn - not as Lost - and the event says it was a sale", () => {
    expect(REMOVAL_REASONS.sold).toMatchObject({ status: "withdrawn", event: "sold" });
    expect(REMOVAL_REASONS.withdrawn).toMatchObject({ status: "withdrawn", event: "withdrawn" });
    expect(REMOVAL_REASONS.lost).toMatchObject({ status: "lost", event: null });
    expect(REMOVAL_REASONS.passed).toMatchObject({ status: "rejected", event: "reiwa_passed" });
  });

  it("only ever writes an outcome status the database already has: never active, converted or merged", () => {
    for (const id of REMOVAL_REASON_ORDER) expect(["withdrawn", "lost", "rejected"]).toContain(REMOVAL_REASONS[id].status);
    expect(REMOVABLE_FROM).toEqual(["active"]);
    expect(RESTORABLE_FROM.sort()).toEqual(["lost", "rejected", "withdrawn"]);
    expect(RESTORABLE_FROM).not.toContain("converted");
    expect(RESTORABLE_FROM).not.toContain("merged");
  });

  it("every event it records is one the property timeline accepts", () => {
    const migration = read("supabase/migrations/0012_property_identity.sql");
    for (const id of REMOVAL_REASON_ORDER) {
      const e = REMOVAL_REASONS[id].event;
      if (e) expect(migration, e).toContain(`'${e}'`);
    }
    expect(migration).toContain("'relaunched'");
  });

  it("cleans the note: trimmed, control characters out, capped, empty means none", () => {
    expect(cleanNote("  sold to X  ")).toBe("sold to X");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote({})).toBeNull();
    expect(cleanNote("a\u0000b")).toBe("a b");
    expect(cleanNote("y".repeat(NOTE_MAX + 50))!.length).toBe(NOTE_MAX);
  });
});

let n = 0;
const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  opportunityId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, orgId: "org", propertyId: null, name: `Asset ${n}`, market: "London",
  submarket: null, assetType: "office", strategy: "core", stage: "new", status: "active", currency: "GBP",
  targetPrice: null, niy: null, reversionaryYield: null, passingRent: null, erv: null, capexBudget: null,
  targetIrr: null, equityMultiple: null, probability: null, source: null, sourceType: "other",
  sourceContactName: null, sourceContactEmail: null, sourcedAt: null, referralNote: null, brokerName: null,
  vendorName: null, priority: "medium", triageStatus: "untriaged", triagePriority: null, triageNote: null,
  ownerUserId: null, ownerName: null, nextMilestone: null, nextMilestoneDate: null, lastMaterialUpdateAt: null,
  sizeSqft: null, sizeSqm: null, summary: null, address: null, city: "London", country: "United Kingdom",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", archivedAt: null, assetId: null,
  caseBasis: "none", caseVersion: null, caseAcquisitionPrice: null, caseTotalCost: null,
  caseEntryYieldPct: null, caseTargetIrr: null, caseEquityMultiple: null, headlinePhotoId: null, ...over,
} as PipelineRow);
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(OpportunityPipeline as never, props));
const table = parseViewState({ view: "table" });

describe("the table", () => {
  const rows = [row({ name: "Live one" }), row({ name: "Gone one", status: "withdrawn" }), row({ name: "Lost one", status: "lost" }), row({ name: "Bought one", status: "converted" })];
  const html = render({ opportunities: rows, initialState: table, canWrite: true });

  it("an active deal has Remove; a removed one has Restore; a converted deal has neither", () => {
    expect((html.match(/data-control="remove-deal"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-control="restore-deal"/g) ?? [])).toHaveLength(2);
  });
  it("someone who cannot write sees neither, and no Actions column", () => {
    const ro = render({ opportunities: rows, initialState: table, canWrite: false });
    expect(ro).not.toContain('data-control="remove-deal"');
    expect(ro).not.toContain('data-control="restore-deal"');
    expect(ro).not.toContain("Actions");
  });
  it("the panel is closed until asked for, so a page of rows is not a page of forms", () => {
    expect(html).not.toContain('role="dialog"');
  });
});

describe("the controls", () => {
  it("Remove renders a closed trigger; Restore renders its button", () => {
    const r = renderToStaticMarkup(createElement(RemoveDealButton, { opportunityId: "id", name: "X", onDone: () => {} }));
    expect(r).toContain('aria-haspopup="dialog"');
    expect(r).toContain('aria-expanded="false"');
    expect(r).toContain("Remove");
    expect(renderToStaticMarkup(createElement(RestoreDealButton, { opportunityId: "id", onDone: () => {} }))).toContain("Restore");
  });
  it("says in the panel's own code that nothing is deleted, and offers every reason", () => {
    const src = read("src/components/opportunities/remove-deal.tsx");
    expect(src).toContain("Nothing is deleted, and you can restore it.");
    expect(src).toContain("REMOVAL_REASON_ORDER.map");
  });
  it("the opportunity page header carries the control, for someone who can write and not for a converted deal", () => {
    const h = read("src/components/workspace/workspace-header.tsx");
    expect(h).toMatch(/canWrite && !converted && <WorkspaceRemoval/);
  });
});
