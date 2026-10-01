// ============================================================================
// Memo composition: every section is built from real rows or is visibly empty.
// ----------------------------------------------------------------------------
// Fixtures in, sections out. No database, no DOM. The rule being protected is the
// one the first memo generator was deleted for breaking (docs/07): an empty
// section and a wrong section must never look the same, and nothing is invented.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeMemo, resolveSection, sameContent, normaliseContent, sectionsFor, emptySectionsFor, unreviewedExternalText, JAPANESE_KEY,
  type MemoSource, type MemoCase, type MemoDdItem, type MemoRisk, type MemoOverrides, type Block,
} from "@/lib/memo/compose";
import { blockText, formatMetric, visibleMetrics, NOT_RECORDED } from "@/lib/memo/render";
import { MEMO_SECTIONS, FORMAT_BY_KEY, type MemoSectionKey } from "@/lib/memo/sections";

const CASE: MemoCase = {
  caseId: "c1", version: 3, status: "approved", strategy: "Value-add",
  thesis: "Core-plus office in a supply-constrained submarket.",
  businessPlanAssumptions: "Re-let floors 3-5 at ERV after a light refurbishment.",
  acquisitionPrice: 64_000_000, acquisitionCosts: 600_000, capex: 1_000_000, totalCost: 65_600_000,
  equity: 35_600_000, grossRentalIncome: 2_048_000, noi: 1_900_800, erv: 2_200_000, occupancyPct: 93.1,
  debt: 30_000_000, ltvPct: 45.73, debtCostPct: 5.4, valuation: 64_000_000, exitValue: 78_000_000,
  entryYieldPct: 2.97, exitYieldPct: 4.5, holdPeriodYears: 5, targetIrr: 14.2, targetEquityMultiple: 1.9,
};

const dd = (over: Partial<MemoDdItem>): MemoDdItem => ({
  ddItemId: "d-" + Math.random(), section: "Capex Plan", item: "Programme cost plan", question: null,
  status: "in_progress", priority: "high", finding: null, resolution: null, ...over,
});
const risk = (over: Partial<MemoRisk>): MemoRisk => ({
  riskId: "r-" + Math.random(), title: "Lease expiry", category: "income", description: null, severity: "medium",
  financialImpact: null, mitigation: null, status: "open", sourceDdItemId: null, ...over,
});

const base = (over: Partial<MemoSource> = {}): MemoSource => ({
  opportunity: {
    name: "58 Queens Gate", market: "London", submarket: "South Kensington", city: "London", country: "United Kingdom",
    assetType: "office", strategy: "value_add", currency: "GBP", sizeSqft: 42_000, sizeSqm: null, summary: "Broker says vendor is motivated.",
  },
  basis: { kind: "approved", case: CASE },
  risks: [], ddItems: [], decision: null, fx: null, ...over,
});

const bare = (): MemoSource => base({ basis: { kind: "none", case: null } });
const section = (src: MemoSource, k: MemoSectionKey) => composeMemo(src).sections[k];
const text = (blocks: Block[], cur = "GBP") => blocks.flatMap((b) => blockText(b, cur)).join("\n");

describe("the memo always has all seventeen sections", () => {
  it("even for an opportunity with no underwriting, risks, diligence, decision or rate", () => {
    const m = composeMemo(bare());
    expect(Object.keys(m.sections).sort()).toEqual(MEMO_SECTIONS.map((s) => s.key).sort());
    expect(m.basis).toEqual({ kind: "none", caseId: null, version: null, caseStatus: null });
  });
});

describe("one composition rule per section", () => {
  it("executive_summary is NEVER composed: empty, and says it is written by hand", () => {
    const s = section(base(), "executive_summary");
    expect(s.status).toBe("empty");
    expect(s.blocks).toEqual([]);
    expect(s.emptyReason).toMatch(/written by hand/);
  });

  it("key_metrics: the approved case's figures, external set and internal set, each with a source", () => {
    const s = section(base(), "key_metrics");
    expect(s.status).toBe("composed");
    expect(s.flags).toEqual([]);
    const [ext, int] = s.blocks;
    expect(ext.audience).toBe("external");
    expect(int.audience).toBe("internal");
    expect(ext.source).toBe("Underwriting v3 (approved)");
    const get = (b: Block, k: string) => (b.kind === "metrics" ? b.items.find((i) => i.key === k)?.value : undefined);
    expect(get(ext, "acquisitionPrice")).toBe(64_000_000);
    expect(get(ext, "targetIrr")).toBe(14.2);
    expect(get(ext, "size")).toBe(42_000);
    expect(get(int, "debt")).toBe(30_000_000);
    expect(get(int, "ltvPct")).toBe(45.73);
  });

  it("key_metrics: a working (unapproved) case is used and FLAGGED, not hidden", () => {
    const s = section(base({ basis: { kind: "working", case: { ...CASE, status: "current" } } }), "key_metrics");
    expect(s.status).toBe("composed");
    expect(s.flags).toEqual(["Based on unapproved underwriting"]);
    expect(s.blocks[0].source).toBe("Underwriting v3 (working version, not approved)");
  });

  it("key_metrics: no case at all is EMPTY, not a table of dashes and not the opportunity's projected columns", () => {
    const s = section(bare(), "key_metrics");
    expect(s.status).toBe("empty");
    expect(s.emptyReason).toMatch(/No underwriting version exists/);
  });

  it("key_metrics: a case that records none of the figures is empty too", () => {
    const blank = Object.fromEntries(Object.keys(CASE).map((k) => [k, null])) as unknown as MemoCase;
    const s = section(base({ basis: { kind: "approved", case: { ...blank, caseId: "c", version: 1, status: "approved" } } }), "key_metrics");
    expect(s.status).toBe("empty");
  });

  it("investment_thesis and business_plan carry the analyst's own text VERBATIM from the case", () => {
    const t = section(base(), "investment_thesis");
    expect(t.blocks).toEqual([expect.objectContaining({ kind: "text", text: CASE.thesis, audience: "external" })]);
    const b = section(base(), "business_plan");
    expect(text(b.blocks)).toContain(CASE.businessPlanAssumptions!);
    expect(text(b.blocks)).toContain("Strategy: Value-add");
  });

  it("investment_thesis: a case with no thesis, or no case, is empty", () => {
    expect(section(base({ basis: { kind: "approved", case: { ...CASE, thesis: "  " } } }), "investment_thesis").status).toBe("empty");
    expect(section(bare(), "investment_thesis").status).toBe("empty");
  });

  it("asset_overview: name, type and strategy labels, size; the free-text summary is INTERNAL", () => {
    const s = section(base(), "asset_overview");
    expect(text(s.blocks.filter((b) => b.audience === "external"))).toContain("Asset: 58 Queens Gate");
    expect(text(s.blocks)).toContain("Approximate size: 42,000 sq ft");
    const summary = s.blocks.find((b) => b.kind === "text")!;
    expect(summary.audience).toBe("internal");
  });

  it("location_market: market, submarket, city, country from the record; nothing more precise", () => {
    const s = section(base(), "location_market");
    expect(text(s.blocks)).toBe("Market: London\nSubmarket: South Kensington\nCity: London\nCountry: United Kingdom");
    expect(section(base({ opportunity: { ...base().opportunity, market: null, submarket: null, city: null, country: null } }), "location_market").status).toBe("empty");
  });

  it("income_tenancy: income figures from the case, internal, plus income and covenant diligence", () => {
    const s = section(base({ ddItems: [dd({ section: "Income Profile and Tenancy", item: "Rent roll" })] }), "income_tenancy");
    expect(text(s.blocks)).toContain("Gross rental income: £2,048,000");
    expect(text(s.blocks)).toContain("Occupancy: 93.10%");
    expect(s.blocks.every((b) => b.audience === "internal")).toBe(true);
    expect(section(bare(), "income_tenancy").status).toBe("empty");
  });

  it("financial_analysis: every underwriting figure the case records, internal", () => {
    const s = section(base(), "financial_analysis");
    expect(text(s.blocks)).toContain("Acquisition costs: £600,000");
    expect(text(s.blocks)).toContain("Target equity multiple: 1.90x");
    expect(s.blocks.every((b) => b.audience === "internal")).toBe(true);
    expect(section(bare(), "financial_analysis").status).toBe("empty");
  });

  it("capex_plan: the capex figure and the capex diligence; empty with neither", () => {
    const s = section(base({ ddItems: [dd({ finding: "QS estimate 1.2m" })] }), "capex_plan");
    expect(text(s.blocks)).toContain("Capital expenditure: £1,000,000");
    expect(text(s.blocks)).toContain("QS estimate 1.2m");
    expect(section(base({ basis: { kind: "approved", case: { ...CASE, capex: null } } }), "capex_plan").status).toBe("empty");
  });

  it("planning_heritage_esg, japan_rationale, tax_structuring: from their diligence workstreams, else empty", () => {
    const src = base({ ddItems: [
      dd({ section: "Planning and Heritage", item: "Listed status", status: "issue_identified", finding: "Grade II listed" }),
      dd({ section: "ESG and Compliance", item: "EPC", status: "not_started" }),
      dd({ section: "Japan Rationale", item: "Depreciation", status: "reviewed" }),
    ] });
    expect(text(section(src, "planning_heritage_esg").blocks)).toContain("Listed status | Issue Identified");
    expect(text(section(src, "planning_heritage_esg").blocks)).toContain("Grade II listed");
    expect(section(src, "japan_rationale").status).toBe("composed");
    expect(section(src, "tax_structuring").status).toBe("empty");
    expect(section(src, "tax_structuring").emptyReason).toMatch(/tax and structuring/);
  });

  it("fx_sensitivity: deal currency, the stored rate WITH its source, and the hedging workstreams", () => {
    const s = section(base({
      fx: { currency: "GBP", rateToGbp: 1, asOf: "2026-08-27", source: "Demo static rates" },
      ddItems: [dd({ section: "Currency Risk and Hedging", item: "Hedging policy" })],
    }), "fx_sensitivity");
    expect(text(s.blocks)).toContain("Deal currency: GBP");
    expect(text(s.blocks)).toContain("Rate source: Demo static rates");
    expect(s.flags).toContain("Rate is a demonstration value, not a market rate");
    expect(text(s.blocks)).toContain("Hedging policy");
  });

  it("fx_sensitivity: with no rate and no hedging workstream it says so and is EMPTY - no hedging narrative", () => {
    const s = section(base(), "fx_sensitivity");
    expect(s.status).toBe("empty");
    expect(s.emptyReason).toMatch(/no exchange rate and no hedging workstream/);
  });

  it("fx_sensitivity: a rate but no hedging data is composed from currency and rate only, and flags the gap", () => {
    const s = section(base({ fx: { currency: "GBP", rateToGbp: 1, asOf: "2026-08-27", source: "ECB" } }), "fx_sensitivity");
    expect(s.status).toBe("composed");
    expect(s.flags).toContain("No hedging workstream is recorded; there is no hedge data in the system");
    expect(s.flags).not.toContain("Rate is a demonstration value, not a market rate");
  });

  it("risk_mitigation: the register ranked by severity then impact, closed excluded, flagged DD issues not already promoted", () => {
    const promoted = dd({ ddItemId: "dd-1", status: "issue_identified", item: "Already promoted" });
    const loose = dd({ ddItemId: "dd-2", status: "issue_identified", item: "Cladding", section: "ESG and Compliance", finding: "Combustible panels" });
    const s = section(base({
      risks: [
        risk({ title: "Low thing", severity: "low" }),
        risk({ title: "Big critical", severity: "critical", financialImpact: 5_000_000, mitigation: "Price chip" }),
        risk({ title: "Small critical", severity: "critical", financialImpact: 100_000 }),
        risk({ title: "Gone", severity: "critical", status: "closed" }),
        risk({ title: "Promoted risk", severity: "high", sourceDdItemId: "dd-1" }),
      ],
      ddItems: [promoted, loose],
    }), "risk_mitigation");
    const t = text(s.blocks);
    expect(t.indexOf("Big critical")).toBeLessThan(t.indexOf("Small critical"));
    expect(t.indexOf("Small critical")).toBeLessThan(t.indexOf("Promoted risk"));
    expect(t.indexOf("Promoted risk")).toBeLessThan(t.indexOf("Low thing"));
    expect(t).not.toContain("Gone");
    expect(t).toContain("Mitigation: Price chip");
    expect(t).toContain("Cladding");
    expect(t).not.toContain("Already promoted");
    expect(section(base(), "risk_mitigation").status).toBe("empty");
  });

  it("recommendation: the committee's RECORDED decision only; with none it is empty and explains there is no stored score", () => {
    const s = section(base({ decision: { decisionDate: "2026-09-10", outcome: "approved_with_conditions", recommendation: "proceed", rationale: "Strong income", conditions: "Capex cap 1.2m" } }), "recommendation");
    expect(text(s.blocks)).toContain("Outcome: approved_with_conditions");
    expect(text(s.blocks)).toContain("Capex cap 1.2m");
    const none = section(base(), "recommendation");
    expect(none.status).toBe("empty");
    expect(none.emptyReason).toMatch(/stores no scores/);
  });

  it("further_dd: open workstreams grouped by section; cleared and not-applicable ones are left out", () => {
    const s = section(base({ ddItems: [
      dd({ section: "Capex Plan", item: "Open one", status: "in_progress" }),
      dd({ section: "Capex Plan", item: "Done one", status: "reviewed" }),
      dd({ section: "Exit Strategy", item: "NA one", status: "not_applicable" }),
      dd({ section: "SWOT", item: "Not started", status: "not_started" }),
    ] }), "further_dd");
    expect(s.blocks.map((b) => (b.kind === "list" ? b.label : ""))).toEqual(["Capex Plan", "SWOT"]);
    expect(text(s.blocks)).not.toMatch(/Done one|NA one/);
    expect(section(base(), "further_dd").emptyReason).toMatch(/No diligence workstreams/);
    expect(section(base({ ddItems: [dd({ status: "resolved" })] }), "further_dd").emptyReason).toMatch(/cleared or not applicable/);
  });

  it("exit_strategy: hold period, exit value and yield from the case; there is no exit text field to invent", () => {
    const s = section(base(), "exit_strategy");
    expect(text(s.blocks)).toContain("Target exit value: £78,000,000");
    expect(section(bare(), "exit_strategy").emptyReason).toMatch(/no exit-strategy text field/);
  });
});

describe("an empty source is empty, never fabricated", () => {
  it("composes no prose of its own: every composed block is a labelled figure, a fact, a list of records or a person's text", () => {
    const m = composeMemo(base({ risks: [risk({})], ddItems: [dd({})] }));
    const kinds = new Set<string>();
    for (const s of Object.values(m.sections)) for (const b of s.blocks) kinds.add(b.kind);
    expect([...kinds].sort()).toEqual(["facts", "list", "metrics", "text"]);
  });

  it("every 'text' block is verbatim text from a record, and carries its source", () => {
    const m = composeMemo(base({ decision: { decisionDate: "d", outcome: "approved", recommendation: null, rationale: "R", conditions: "C" } }));
    const allowed = new Set([CASE.thesis, CASE.businessPlanAssumptions, "Broker says vendor is motivated.", "R", "C"]);
    for (const s of Object.values(m.sections)) {
      for (const b of s.blocks) {
        expect(b.source.length).toBeGreaterThan(0);
        if (b.kind === "text") expect(allowed.has(b.text), b.text).toBe(true);
      }
    }
  });

  it("with nothing recorded, only the asset overview and location (from the opportunity itself) have content", () => {
    const m = composeMemo(bare());
    const composed = MEMO_SECTIONS.filter((s) => m.sections[s.key].status === "composed").map((s) => s.key);
    expect(composed).toEqual(["asset_overview", "location_market"]);
  });

  it("every empty section states what is missing", () => {
    const m = composeMemo(bare());
    for (const s of MEMO_SECTIONS) {
      const c = m.sections[s.key];
      if (c.status === "empty") expect(c.emptyReason, s.key).toMatch(/\S{8}/);
    }
  });
});

describe("a person's override always wins", () => {
  const overrides: MemoOverrides = { key_metrics: "Hand-written metrics paragraph.", executive_summary: "We recommend this deal." };

  it("over a composed section", () => {
    const r = resolveSection(section(base(), "key_metrics"), overrides.key_metrics, "ic");
    expect(r.state).toBe("edited");
    expect(r.overrideText).toBe("Hand-written metrics paragraph.");
    expect(r.blocks).toEqual([]);
  });

  it("over an empty section: an empty section the person filled in is edited, not empty", () => {
    expect(resolveSection(section(base(), "executive_summary"), overrides.executive_summary, "teaser").state).toBe("edited");
  });

  it("a blank override is no override", () => {
    expect(resolveSection(section(base(), "key_metrics"), "   ", "ic").state).toBe("composed");
    expect(resolveSection(section(base(), "key_metrics"), null, "ic").state).toBe("composed");
  });

  it("is shown in every format, because a person chose to write it", () => {
    for (const f of ["ic", "teaser", "snapshot"] as const) {
      expect(resolveSection(section(base(), "financial_analysis"), "Mine", f).state).toBe("edited");
    }
  });

  it("does not alter the composed record", () => {
    const m = composeMemo(base());
    const before = JSON.stringify(m);
    resolveSection(m.sections.key_metrics, "x", "ic");
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("formats are lenses on one record", () => {
  it("the section lists are the ones sections.ts defines, in memo order", () => {
    expect(sectionsFor("teaser")).toEqual(FORMAT_BY_KEY.teaser.sections);
    expect(sectionsFor("snapshot")).toEqual(["executive_summary", "key_metrics", "asset_overview"]);
    expect(sectionsFor("ic")).toHaveLength(17);
  });

  it("the teaser and snapshot show EXTERNAL blocks only: financing, NOI, income, DD and risks never reach them", () => {
    const m = composeMemo(base({ risks: [risk({ title: "Secret risk" })], ddItems: [dd({ section: "Exit Strategy", finding: "Vendor desperate" })] }));
    const everything: string[] = [];
    for (const f of ["teaser", "snapshot"] as const) {
      for (const k of sectionsFor(f)) {
        const r = resolveSection(m.sections[k], null, f);
        everything.push(text(r.blocks));
      }
    }
    const t = everything.join("\n");
    for (const forbidden of ["Debt", "Equity:", "LTV", "Net operating income", "Total cost", "Debt cost", "Secret risk", "Vendor desperate", "motivated", "Gross rental"]) {
      expect(t, forbidden).not.toContain(forbidden);
    }
    expect(t).toContain("Target IRR: 14.2%");
    expect(t).toContain("Target acquisition value: £64,000,000");
  });

  it("the IC memo shows the internal blocks the teaser withheld, and says how many were withheld", () => {
    const m = composeMemo(base());
    expect(text(resolveSection(m.sections.key_metrics, null, "ic").blocks)).toContain("Debt: £30,000,000");
    const teaser = resolveSection(m.sections.key_metrics, null, "teaser");
    expect(teaser.withheld).toBe(1);
  });

  it("a section whose only content is internal reads as EMPTY in an external format, with a reason that is not about the deal", () => {
    const m = composeMemo(base({ ddItems: [dd({ section: "Exit Strategy", finding: "x" })] }));
    // exit_strategy has external figures here; a case-less memo with only DD has none.
    const m2 = composeMemo(base({ basis: { kind: "none", case: null }, ddItems: [dd({ section: "Exit Strategy", finding: "x" })] }));
    const r = resolveSection(m2.sections.exit_strategy, null, "teaser");
    expect(r.state).toBe("empty");
    expect(r.emptyReason).toMatch(/internal and is not shown in this format/);
    expect(resolveSection(m.sections.exit_strategy, null, "teaser").state).toBe("composed");
  });

  it("emptySectionsFor lists what would print blank, counting an override as filled", () => {
    const m = composeMemo(bare());
    expect(emptySectionsFor(m, {}, "teaser")).toEqual(["executive_summary", "key_metrics", "investment_thesis", "business_plan", "exit_strategy"]);
    expect(emptySectionsFor(m, { executive_summary: "x", key_metrics: "y" }, "teaser")).toEqual(["investment_thesis", "business_plan", "exit_strategy"]);
    expect(emptySectionsFor(m, {}, "japanese")).toEqual([]);
  });

  it("unreviewedExternalText names the sections that carry analyst-written underwriting text into an external format", () => {
    const m = composeMemo(base());
    expect(unreviewedExternalText(m, {}, "teaser")).toEqual(["investment_thesis", "business_plan"]);
    expect(unreviewedExternalText(m, { investment_thesis: "rewritten for investors" }, "teaser")).toEqual(["business_plan"]);
    expect(unreviewedExternalText(m, {}, "ic")).toEqual([]);
  });

  it("the Japanese summary is a single hand-written text under its own key", () => {
    expect(JAPANESE_KEY).toBe("japanese_summary");
  });
});

describe("metric formatting", () => {
  it("formats by kind, and a missing value is 'Not recorded', never zero or a dash", () => {
    const c = "GBP";
    expect(formatMetric({ key: "a", label: "", value: 64_000_000, format: "money" }, c)).toBe("£64,000,000");
    expect(formatMetric({ key: "a", label: "", value: 14.2, format: "pct1" }, c)).toBe("14.2%");
    expect(formatMetric({ key: "a", label: "", value: 2.97, format: "pct" }, c)).toBe("2.97%");
    expect(formatMetric({ key: "a", label: "", value: 1.9, format: "multiple" }, c)).toBe("1.90x");
    expect(formatMetric({ key: "a", label: "", value: 5, format: "years" }, c)).toBe("5 years");
    expect(formatMetric({ key: "a", label: "", value: null, format: "money" }, c)).toBe(NOT_RECORDED);
    expect(formatMetric({ key: "a", label: "", value: 0, format: "money" }, c)).toBe("£0");
  });

  it("a printed external document does not claim a metric it has no value for; the workspace shows the gap", () => {
    const items = [{ key: "a", label: "A", value: 1, format: "years" as const }, { key: "b", label: "B", value: null, format: "years" as const }];
    expect(visibleMetrics(items, "teaser", "print").map((i) => i.key)).toEqual(["a"]);
    expect(visibleMetrics(items, "teaser", "workspace").map((i) => i.key)).toEqual(["a", "b"]);
    expect(visibleMetrics(items, "ic", "print").map((i) => i.key)).toEqual(["a", "b"]);
  });
});

describe("what a memo can see: the boundary that keeps location and photographs out", () => {
  const code = readFileSync(join(process.cwd(), "src/lib/memo/compose.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("the composition module has no address, coordinate, geocode, photograph, broker, vendor or triage field", () => {
    expect(code).not.toMatch(/address|latitude|longitude|geocode|formatted|place_?id|photo|street.?view|broker|vendor|triage|sourceContact|referral/i);
  });

  it("and no server, database or model import", () => {
    expect(code).not.toMatch(/from "@\/lib\/(db|data|supabase|auth)|from "pg"|anthropic|openai|fetch\(/);
  });
});

describe("a stored memo read back", () => {
  it("is the same content even though Postgres reorders jsonb keys, and different when a record changed", () => {
    const m = composeMemo(base({ risks: [risk({ title: "A" })] }));
    // What a jsonb round trip does to key order: here, reversed at every level.
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, reorder(x)])) : v;
    const back = normaliseContent(reorder(JSON.parse(JSON.stringify(m))))!;
    expect(JSON.stringify(back)).not.toBe(JSON.stringify(m));
    expect(sameContent(m, back)).toBe(true);
    expect(sameContent(m, composeMemo(base({ risks: [risk({ title: "B" })] })))).toBe(false);
    expect(sameContent(m, composeMemo(base({ basis: { kind: "working", case: CASE } })))).toBe(false);
  });

  it("a memo saved before a section existed reads that section as EMPTY, never as a crash or invented content", () => {
    const m = composeMemo(base());
    const old = JSON.parse(JSON.stringify(m));
    delete old.sections.tax_structuring;
    const back = normaliseContent(old)!;
    expect(back.sections.tax_structuring.status).toBe("empty");
    expect(back.sections.tax_structuring.emptyReason).toMatch(/did not exist when the memo was composed/);
    expect(back.sections.key_metrics).toEqual(m.sections.key_metrics);
  });

  it("something that is not a memo is refused", () => {
    expect(normaliseContent(null)).toBeNull();
    expect(normaliseContent("x")).toBeNull();
    expect(normaliseContent({ sections: {} })).toBeNull();
  });
});
