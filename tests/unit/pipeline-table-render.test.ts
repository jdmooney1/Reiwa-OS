// ============================================================================
// The pipeline table improvements, as rendered: filter controls, sortable headers, the saved-views
// button, the triage button and the triage card. Static markup; the browser behaviour (keys, URL
// updates) is exercised end to end separately.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PipelineRow } from "@/lib/data/opportunity-file";
import { parseViewState } from "@/lib/pipeline/view-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/pipeline" }));
vi.mock("@/app/actions/triage", () => ({ triageDealAction: async () => ({}), undoTriageAction: async () => ({}) }));
vi.mock("@/app/actions/pipeline-views", () => ({ saveViewAction: async () => ({}), updateViewAction: async () => ({}), deleteViewAction: async () => ({}) }));

import { OpportunityPipeline } from "@/components/opportunities/opportunity-pipeline";
import { SavedViewsMenu } from "@/components/opportunities/pipeline-saved-views";
import { TriageMode } from "@/components/opportunities/pipeline-triage";

let n = 0;
const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  opportunityId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, orgId: "org", propertyId: null, name: `Asset ${n}`, market: "London",
  submarket: null, assetType: "office", strategy: "core", stage: "new", status: "active", currency: "GBP",
  targetPrice: null, niy: null, reversionaryYield: null, passingRent: null, erv: null, capexBudget: null,
  targetIrr: null, equityMultiple: null, probability: null, source: "Broker email", sourceType: "other",
  sourceContactName: "Pat Example", sourceContactEmail: null, sourcedAt: null, referralNote: null, brokerName: "Example Partners",
  vendorName: null, priority: "medium", triageStatus: "untriaged", triagePriority: null, triageNote: null,
  ownerUserId: null, ownerName: null, nextMilestone: null, nextMilestoneDate: null, lastMaterialUpdateAt: null,
  sizeSqft: 12000, sizeSqm: null, summary: null, address: "1 Example Street, London", city: "London", country: "United Kingdom",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", archivedAt: null, assetId: null,
  caseBasis: "working", caseVersion: 1, caseAcquisitionPrice: null, caseTotalCost: null,
  caseEntryYieldPct: null, caseTargetIrr: null, caseEquityMultiple: null, headlinePhotoId: null, ...over,
} as PipelineRow);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(OpportunityPipeline as never, props));

const ROWS = [
  row({ name: "Cheap", caseAcquisitionPrice: 3_000_000, caseEntryYieldPct: 7, caseTargetIrr: 9 }),
  row({ name: "Mid", caseAcquisitionPrice: 10_000_000, caseEntryYieldPct: 6, caseTargetIrr: 12 }),
  row({ name: "Dear", caseAcquisitionPrice: 40_000_000, caseEntryYieldPct: 5, caseTargetIrr: 15 }),
  row({ name: "Blank" }),
  row({ name: "Yen", currency: "JPY", caseAcquisitionPrice: 5_000_000_000 }),
  row({ name: "Decided", triageStatus: "live", caseAcquisitionPrice: 8_000_000 }),
];

describe("filters", () => {
  const html = render({ opportunities: ROWS, initialState: parseViewState({ pmin: "5", pmax: "15", ymin: "6" }) });

  it("draws the four price presets and three yield presets, with the active ones pressed", () => {
    for (const label of ["Under £5m", "£5-15m", "£15-30m", "£30m+"]) expect(html).toContain(label);
    for (const label of ["5%+", "6%+", "7%+"]) expect(html).toContain(label);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-preset="5-15"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-preset="lt5"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-preset="y6"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-preset="y5"/);
  });

  it("fills the custom boxes from the address bar, so what is applied is what is shown", () => {
    expect(html).toMatch(/aria-label="Price from[^>]*value="5"/);
    expect(html).toMatch(/aria-label="Price up to[^>]*value="15"/);
    expect(html).toMatch(/aria-label="Minimum entry yield, percent"[^>]*value="6"/);
  });

  it("applies them to the board, combined", () => {
    expect(text(html)).toContain("1 of 6 deals match");      // only "Mid" is £5-15m and 6%+ (Decided has no yield)
  });

  it("says what the pound range left out: a deal that passes everything else but is not in pounds", () => {
    const priceOnly = text(render({ opportunities: ROWS, initialState: parseViewState({ pmin: "5", pmax: "15" }) }));
    expect(priceOnly).toContain("1 deal not in pounds is left out: the price range is for GBP only");
    // With the yield filter on as well, the yen deal (which has no yield) would not have matched anyway: nothing to report.
    expect(text(html)).not.toContain("not in pounds");
  });

  it("the plain pipeline shows no note and no pressed preset", () => {
    const plain = render({ opportunities: ROWS });
    expect(plain).not.toContain('data-note="non-gbp"');
    expect(plain).not.toContain('aria-pressed="true"');
  });
});

describe("sortable columns", () => {
  const sorted = render({ opportunities: ROWS, initialState: parseViewState({ view: "table", sort: "-price" }) });
  const order = (html: string) => [...html.matchAll(/href="\/opportunities\/[^"]+"[^>]*>(Cheap|Mid|Dear|Blank|Yen|Decided)</g)].map((m) => m[1]);

  it("Price, Total cost, Entry yield and IRR are buttons; no other header is", () => {
    for (const k of ["price", "totalCost", "entryYield", "irr"]) expect(sorted).toContain(`data-sort="${k}"`);
    expect((sorted.match(/data-sort="/g) ?? []).length).toBe(4);   // the four, and no other header
  });

  it("marks the sorted column with aria-sort and the others none", () => {
    expect(sorted).toMatch(/<th[^>]*aria-sort="descending"[^>]*>\s*<button[^>]*data-sort="price"/);
    expect(sorted).toMatch(/<th[^>]*aria-sort="none"[^>]*>\s*<button[^>]*data-sort="irr"/);
  });

  it("orders the rows highest price first with blanks and non-pound deals last", () => {
    expect(order(sorted)).toEqual(["Dear", "Mid", "Decided", "Cheap", "Blank", "Yen"]);
  });

  it("ascending puts the cheapest first and still keeps the blanks last", () => {
    const asc = render({ opportunities: ROWS, initialState: parseViewState({ view: "table", sort: "price" }) });
    expect(order(asc)).toEqual(["Cheap", "Decided", "Mid", "Dear", "Blank", "Yen"]);
  });

  it("without a sort the rows keep the order they arrived in", () => {
    expect(order(render({ opportunities: ROWS, initialState: parseViewState({ view: "table" }) }))).toEqual(["Cheap", "Mid", "Dear", "Blank", "Yen", "Decided"]);
  });
});

describe("triage button", () => {
  it("shows the number of untriaged deals in the current view, for someone who can write", () => {
    const t = text(render({ opportunities: ROWS, canWrite: true }));
    expect(t).toContain("Triage (5)");                       // everything but "Decided"
    expect(text(render({ opportunities: ROWS, canWrite: true, initialState: parseViewState({ pmin: "5" }) }))).toContain("Triage (2)");
  });
  it("is not drawn for someone who cannot write", () => {
    expect(render({ opportunities: ROWS, canWrite: false })).not.toContain('data-action="enter-triage"');
    expect(render({ opportunities: ROWS })).not.toContain('data-action="enter-triage"');
  });
  it("is disabled when nothing in the view is untriaged", () => {
    expect(render({ opportunities: [ROWS[5]], canWrite: true })).toMatch(/data-action="enter-triage"[^>]*disabled|disabled=""[^>]*data-action="enter-triage"/);
  });
});

describe("saved views button", () => {
  const view = { viewId: "v1", name: "Core London", updatedAt: "2026-10-07", state: parseViewState({ market: "London", ymin: "6" }) };
  const menu = (state: ReturnType<typeof parseViewState>, activeId: string | null, available = true) =>
    renderToStaticMarkup(createElement(SavedViewsMenu, { initial: [view], available, state, activeId, onApply: () => {}, onActive: () => {} }));

  it("says Views when none is active, and the name when one is", () => {
    expect(text(menu(parseViewState({}), null))).toContain("Views");
    expect(text(menu(view.state, "v1"))).toContain("Core London");
  });
  it("flags the active view as changed when the filters on screen have moved on from it", () => {
    expect(menu(view.state, "v1")).not.toContain('data-flag="modified"');
    expect(menu(parseViewState({ market: "London", ymin: "7" }), "v1")).toContain('data-flag="modified"');
  });
});

describe("triage card", () => {
  const queue = [ROWS[0], ROWS[1]];
  const html = renderToStaticMarkup(createElement(TriageMode, {
    queueIds: queue.map((r) => r.opportunityId), rows: ROWS, onDecided: () => {}, onUndone: () => {}, onExit: () => {},
  }));
  const t = text(html);

  it("shows the first deal with its figures, the position in the queue, and a way to open the record", () => {
    expect(t).toContain("Deal 1 of 2");
    expect(t).toContain("2 left");
    expect(html).toContain('data-deal="' + queue[0].opportunityId + '"');
    expect(t).toContain("Cheap");
    expect(t).toContain("£3.0m");
    expect(t).toContain("Example Partners · Pat Example");
    expect(html).toContain(`href="/opportunities/${queue[0].opportunityId}"`);
  });

  it("offers Pursue, Watch and Pass with their keys, plus skip, back and undo", () => {
    for (const [d, key] of [["pursue", "P"], ["watch", "W"], ["pass", "X"]] as const) {
      expect(html).toMatch(new RegExp(`aria-keyshortcuts="${key}"[^>]*data-decision="${d}"|data-decision="${d}"[^>]*aria-keyshortcuts="${key}"`));
    }
    expect(html).toContain('aria-keyshortcuts="S ArrowRight"');
    expect(html).toContain('aria-keyshortcuts="U"');
    expect(t).toContain("Reason");
  });

  it("says plainly how Watch and Pursue are saved", () => {
    expect(t).toContain("Watch is saved as a live deal at the lowest priority (P3)");
  });

  it("an empty queue says there is nothing to triage", () => {
    const e = renderToStaticMarkup(createElement(TriageMode, { queueIds: [], rows: ROWS, onDecided: () => {}, onUndone: () => {}, onExit: () => {} }));
    expect(e).toContain('data-state="empty"');
    expect(text(e)).toContain("Nothing to triage in this view");
  });

  it("a deal already decided (stepping back) cannot be decided again from the card", () => {
    const d = renderToStaticMarkup(createElement(TriageMode, { queueIds: [ROWS[5].opportunityId], rows: ROWS, onDecided: () => {}, onUndone: () => {}, onExit: () => {} }));
    expect(d).toContain('data-state="decided"');
    expect((d.match(/data-decision="[a-z]+"[^>]*disabled|disabled=""[^>]*data-decision/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
