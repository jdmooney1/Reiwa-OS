// ============================================================================
// Memo composition: every section is built from real rows or is visibly empty.
// ----------------------------------------------------------------------------
// Fixtures in, sections out. No database, no DOM. The rule being protected is the
// one the first memo generator was deleted for breaking (docs/07): an empty
// section and a wrong section must never look the same, and nothing is invented.
// ============================================================================
import { NO_PROJECTION, NO_ASSET } from "./memo-source.fixture";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeMemo, resolveSection, sameContent, normaliseContent, sectionsFor, emptySectionsFor, unreviewedExternalText, JAPANESE_KEY,
  type MemoSource, type MemoCase, type MemoDdItem, type MemoRisk, type MemoOverrides, type MemoScore, type Block,
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
  landValue: null, buildingValue: null, depreciationYears: null, depreciationMethod: null,
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
    assetType: "office", strategy: "value_add", currency: "GBP", sizeSqft: 42_000, sizeSqm: null, summary: "Broker says vendor is motivated.", projected: NO_PROJECTION,
  },
  basis: { kind: "approved", case: CASE },
  risks: [], ddItems: [], decision: null, score: null, fx: null, fxLock: null, today: "2026-09-01", fxJpy: null, asset: NO_ASSET, ...over,
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

  it("investment_thesis and business_plan still carry the analyst's own text VERBATIM, but as INTERNAL blocks", () => {
    const t = section(base(), "investment_thesis");
    expect(t.status).toBe("composed");
    expect(t.blocks).toEqual([expect.objectContaining({ kind: "text", text: CASE.thesis, audience: "internal", source: "Underwriting v3 (approved)" })]);
    const b = section(base(), "business_plan");
    expect(b.status).toBe("composed");
    expect(text(b.blocks)).toContain(CASE.businessPlanAssumptions!);
    expect(text(b.blocks)).toContain("Strategy: Value-add");
    expect(b.blocks.every((x) => x.audience === "internal")).toBe(true);
  });

  it("in the Internal IC Memo both sections show the full analyst text, sourced, exactly as before", () => {
    const m = composeMemo(base());
    const thesis = resolveSection(m.sections.investment_thesis, null, "ic");
    expect(thesis.state).toBe("composed");
    expect(text(thesis.blocks)).toBe(CASE.thesis);
    expect(thesis.blocks[0].source).toBe("Underwriting v3 (approved)");
    const plan = resolveSection(m.sections.business_plan, null, "ic");
    expect(plan.state).toBe("composed");
    expect(text(plan.blocks)).toContain(CASE.businessPlanAssumptions!);
    expect(plan.withheld).toBe(0);
  });

  it("in the Teaser and the Snapshot both sections are EMPTY and say to write an investor-facing version; none of the analyst's text appears", () => {
    const m = composeMemo(base());
    for (const f of ["teaser", "snapshot"] as const) {
      for (const k of ["investment_thesis", "business_plan"] as const) {
        const r = resolveSection(m.sections[k], null, f);
        expect(r.state, `${f}/${k}`).toBe("empty");
        expect(r.blocks).toEqual([]);
        expect(r.emptyReason).toBe("The recorded content for this section is internal and is not shown in this format. Write an investor-facing version in the override box.");
        expect(r.withheld).toBeGreaterThan(0);
      }
    }
    // The strategy label would otherwise stand alone under a Business Plan heading.
    expect(text(resolveSection(m.sections.business_plan, null, "teaser").blocks)).toBe("");
  });

  it("a section withheld from an external format does not carry flags about content it is not showing", () => {
    const m = composeMemo(base({ basis: { kind: "working", case: { ...CASE, status: "current" } } }));
    expect(m.sections.investment_thesis.flags).toEqual(["Based on unapproved underwriting"]);
    expect(resolveSection(m.sections.investment_thesis, null, "ic").flags).toEqual(["Based on unapproved underwriting"]);
    expect(resolveSection(m.sections.investment_thesis, null, "teaser").flags).toEqual([]);
    // A section that is genuinely empty at source keeps its flags.
    const none = composeMemo(base({ basis: { kind: "working", case: { ...CASE, status: "current", thesis: null } } }));
    expect(resolveSection(none.sections.investment_thesis, null, "teaser").flags).toEqual(["Based on unapproved underwriting"]);
  });

  it("an override for either section appears in the external formats, exactly as for every other section", () => {
    const m = composeMemo(base());
    for (const f of ["teaser", "snapshot"] as const) {
      const t = resolveSection(m.sections.investment_thesis, "Prime South Kensington office with reversionary upside.", f);
      expect(t.state).toBe("edited");
      expect(t.overrideText).toBe("Prime South Kensington office with reversionary upside.");
      expect(resolveSection(m.sections.business_plan, "Refurbish and re-let.", f).state).toBe("edited");
    }
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

  describe("fx_sensitivity: a rate that has gone stale says so", () => {
    const withRate = (asOf: string, today: string, source = "ECB euro reference rate") =>
      section(base({ today, fx: { currency: "EUR", rateToGbp: 0.85, asOf, source } }), "fx_sensitivity");
    const staleFlag = (s: ReturnType<typeof withRate>) => s.flags.find((f) => /days old/.test(f));

    it("flags a rate older than 30 days, with its age and date, and still composes the section", () => {
      const s = withRate("2026-08-27", "2026-10-05");
      expect(s.status).toBe("composed");
      expect(staleFlag(s)).toContain("This rate is 39 days old.");
      expect(staleFlag(s)).toContain("2026-08-27");
      expect(text(s.blocks)).toContain("Rate age: 39 days");
    });

    it("does not flag a rate of exactly 30 days, and does flag 31", () => {
      expect(staleFlag(withRate("2026-09-05", "2026-10-05"))).toBeUndefined();
      expect(text(withRate("2026-09-05", "2026-10-05").blocks)).not.toContain("Rate age");
      expect(staleFlag(withRate("2026-09-04", "2026-10-05"))).toContain("31 days old");
    });

    it("measures against the date the memo is composed on, not the clock", () => {
      expect(staleFlag(withRate("2026-08-27", "2026-09-10"))).toBeUndefined();
      expect(staleFlag(withRate("2026-08-27", "2026-12-01"))).toContain("96 days old");
    });

    it("says the age is unknown when the date cannot be read, rather than calling the rate fresh", () => {
      expect(withRate("last Tuesday", "2026-10-05").flags).toContain("The date of this rate could not be read, so its age is unknown");
    });

    it("never calls the base currency stale: GBP to GBP is 1 whatever its date", () => {
      const s = section(base({ today: "2026-12-01", fx: { currency: "GBP", rateToGbp: 1, asOf: "2026-08-27", source: "Base currency" } }), "fx_sensitivity");
      expect(s.flags.find((f) => /days old|could not be read/.test(f))).toBeUndefined();
      expect(text(s.blocks)).not.toContain("Rate age");
    });

    it("keeps the demo-rate flag alongside the staleness flag", () => {
      const s = withRate("2026-08-27", "2026-10-05", "Demo static rates");
      expect(s.flags).toContain("Rate is a demonstration value, not a market rate");
      expect(staleFlag(s)).toBeDefined();
    });
  });

  describe("fx_sensitivity: the rate locked at approval and the live rate are two figures", () => {
    const LOCK = { rateToGbp: 0.86, source: "ECB reference rate (auto)", asOf: "2026-09-20", approvedOn: "2026-09-22" };
    const LIVE = { currency: "EUR", rateToGbp: 0.88, asOf: "2026-09-30", source: "ECB reference rate (auto)" };
    const eur = (over: Partial<MemoSource>) => section(base({
      today: "2026-10-02", opportunity: { ...base().opportunity, currency: "EUR" }, ...over,
    }), "fx_sensitivity");

    it("shows both, each under its own label, with different values", () => {
      const s = eur({ fxLock: LOCK, fx: LIVE });
      const t = text(s.blocks);
      expect(t).toContain("Rate locked at approval (EUR to GBP): 0.86");
      expect(t).toContain("Locked rate as of: 2026-09-20");
      expect(t).toContain("Approved on: 2026-09-22");
      expect(t).toContain("Current rate (live): EUR to GBP: 0.88");
      expect(t).toContain("Current rate as of: 2026-09-30");
      // Not one unlabelled rate standing in for both questions.
      expect(t).not.toMatch(/(^|\n)EUR to GBP: /);
    });

    it("reports the movement since approval from the two real figures", () => {
      expect(text(eur({ fxLock: LOCK, fx: LIVE }).blocks)).toContain("Movement since approval: 2.33%");
      expect(text(eur({ fxLock: LOCK, fx: { ...LIVE, rateToGbp: 0.8 } }).blocks)).toContain("Movement since approval: -6.98%");
    });

    it("keeps the two blocks apart in provenance too", () => {
      const sources = eur({ fxLock: LOCK, fx: LIVE }).blocks.map((b) => b.source);
      expect(sources.some((x) => /locked at approval/.test(x))).toBe(true);
      expect(sources.some((x) => /\(current\)/.test(x))).toBe(true);
    });

    it("an approved case with no lock says none was locked, and still shows the live rate", () => {
      const s = eur({ fxLock: null, fx: LIVE, basis: { kind: "approved", case: CASE } });
      expect(s.flags.join(" ")).toMatch(/No exchange rate was locked at approval/);
      expect(text(s.blocks)).toContain("EUR to GBP: 0.88");
      expect(text(s.blocks)).not.toContain("Rate locked at approval");
    });

    it("a case that is not approved has no lock and says nothing about one", () => {
      const s = eur({ fxLock: null, fx: LIVE, basis: { kind: "working", case: CASE } });
      expect(s.flags.join(" ")).not.toMatch(/locked at approval/);
    });

    it("flags a locked rate that was a demonstration value, or already stale on the day", () => {
      expect(eur({ fxLock: { ...LOCK, source: "Demo static rates" }, fx: LIVE }).flags).toContain("The rate locked at approval was a demonstration value, not a market rate");
      expect(eur({ fxLock: { ...LOCK, asOf: "2026-07-01" }, fx: LIVE }).flags.join(" ")).toMatch(/locked at approval was 83 days old/);
      expect(eur({ fxLock: LOCK, fx: LIVE }).flags.join(" ")).not.toMatch(/days old/);
    });

    it("composes from a lock alone when there is no live rate", () => {
      const s = eur({ fxLock: LOCK, fx: null });
      expect(s.status).toBe("composed");
      expect(s.flags).toContain("No exchange rate is recorded for EUR");
    });

    it("never calls a GBP deal's rate stale or moved", () => {
      const s = section(base({ today: "2026-12-01", basis: { kind: "approved", case: CASE },
        fxLock: { rateToGbp: 1, source: "Base currency", asOf: "2026-01-01", approvedOn: "2026-06-01" },
        fx: { currency: "GBP", rateToGbp: 1, asOf: "2026-01-01", source: "Base currency" } }), "fx_sensitivity");
      expect(s.flags.join(" ")).not.toMatch(/days old/);
      expect(text(s.blocks)).not.toContain("Movement since approval");
    });
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

  const SCORE: MemoScore = {
    version: 2, scoredAt: "2026-09-20T10:00:00.000Z", overall: 72.4, recommendationLabel: "Proceed",
    categories: [
      { key: "location_quality", label: "Location Quality", weight: 15, score: 9, commentary: "Prime micro-location.", riskFlag: false },
      { key: "capex_risk", label: "Capex Risk", weight: 10, score: 4, commentary: "QS range is wide.", riskFlag: true },
    ],
  };
  const DECISION = { decisionDate: "2026-09-10", outcome: "approved_with_conditions", recommendation: "proceed_with_caution", rationale: "Strong income", conditions: "Capex cap 1.2m" };

  it("recommendation: with BOTH a score and a decision, shows both, side by side, neither overwriting the other", () => {
    const s = section(base({ score: SCORE, decision: DECISION }), "recommendation");
    expect(s.status).toBe("composed");
    expect(s.flags).toEqual([]);
    const t = text(s.blocks);
    expect(t).toContain("Overall score: 72.4 / 100");
    expect(t).toContain("Model recommendation: Proceed");
    expect(t).toContain("Criteria flagged as risks: 1");
    expect(t).toContain("Capex Risk | 4/10 | weight 10 | risk flagged");
    expect(t).toContain("QS range is wide.");
    expect(t).toContain("Committee outcome: approved_with_conditions");
    expect(t).toContain("Recommendation recorded: Proceed with Caution");   // the committee's, labelled, distinct from the model's
    expect(t).toContain("Capex cap 1.2m");
    expect(t.indexOf("Model recommendation")).toBeLessThan(t.indexOf("Committee outcome"));
    expect(s.blocks.every((b) => b.audience === "internal")).toBe(true);
    expect(s.blocks.map((b) => b.source)).toEqual(expect.arrayContaining(["Investment Score v2", "Investment committee decision, 2026-09-10"]));
  });

  it("recommendation: a score with no decision shows the score and says no decision is recorded", () => {
    const s = section(base({ score: SCORE }), "recommendation");
    expect(s.status).toBe("composed");
    expect(text(s.blocks)).toContain("Overall score: 72.4 / 100");
    expect(text(s.blocks)).not.toContain("Committee outcome");
    expect(s.flags).toEqual(["No investment committee decision is recorded"]);
  });

  it("recommendation: a decision with no score shows the decision and says no score is recorded", () => {
    const s = section(base({ decision: DECISION }), "recommendation");
    expect(s.status).toBe("composed");
    expect(text(s.blocks)).toContain("Committee outcome: approved_with_conditions");
    expect(text(s.blocks)).not.toContain("Overall score");
    expect(s.flags).toEqual(["No Investment Score is recorded"]);
  });

  it("recommendation: neither is EMPTY and the reason names both as missing", () => {
    const s = section(base(), "recommendation");
    expect(s.status).toBe("empty");
    expect(s.emptyReason).toMatch(/No Investment Score and no investment committee decision/);
    expect(s.emptyReason).toMatch(/Score tab/);
    expect(s.emptyReason).toMatch(/Decision tab/);
  });

  it("recommendation stays INTERNAL: the teaser and snapshot cannot show a score or a decision (they do not list it, and a resolved view withholds it)", () => {
    const m = composeMemo(base({ score: SCORE, decision: DECISION }));
    const r = resolveSection(m.sections.recommendation, null, "teaser");
    expect(r.state).toBe("empty");
    expect(text(r.blocks)).toBe("");
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
    // The Snapshot is a purpose-built grid (ComposedMemo.snapshot), not a subset of the prose sections.
    expect(sectionsFor("snapshot")).toEqual([]);
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

  it("with a full underwriting, the teaser still lists thesis and business plan as printing blank: they are internal by default", () => {
    const m = composeMemo(base());
    expect(emptySectionsFor(m, {}, "teaser")).toEqual(["executive_summary", "investment_thesis", "business_plan"]);
    expect(emptySectionsFor(m, {}, "snapshot")).toEqual([]);
    expect(emptySectionsFor(m, { executive_summary: "s", investment_thesis: "t", business_plan: "b" }, "teaser")).toEqual([]);
    expect(emptySectionsFor(m, {}, "ic")).not.toContain("investment_thesis");
  });

  it("unreviewedExternalText is now always empty for underwriting text: nothing the analyst wrote reaches an external format unwritten-for-investors", () => {
    const m = composeMemo(base());
    for (const f of ["teaser", "snapshot", "ic", "japanese"] as const) {
      expect(unreviewedExternalText(m, {}, f), f).toEqual([]);
    }
    expect(unreviewedExternalText(m, { investment_thesis: "rewritten for investors" }, "teaser")).toEqual([]);
  });

  it("no composed `text` block anywhere is external: external prose can only come from a person's override", () => {
    const m = composeMemo(base({
      decision: { decisionDate: "2026-09-10", outcome: "approved", recommendation: "proceed", rationale: "R", conditions: "C" },
      risks: [risk({ description: "d", mitigation: "m" })],
      ddItems: [dd({ finding: "f" })],
    }));
    for (const [key, s] of Object.entries(m.sections)) {
      for (const b of s.blocks) if (b.kind === "text") expect(b.audience, `${key}: ${b.source}`).toBe("internal");
    }
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
  const raw = readFileSync(join(process.cwd(), "src/lib/memo/compose.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const FORBIDDEN = /address|latitude|longitude|geocode|formatted|place_?id|photo|street.?view|broker|vendor|triage|sourceContact|referral/i;
  // The ONE sanctioned exception: the Asset Snapshot (decision: JD). Everything that
  // may name an address or a photograph is one of these declarations, and nothing else.
  const SANCTIONED = new Set(["MemoAssetFacts", "ComposedSnapshot", "composeSnapshot", "finaliseNotices", "isSnapshot"]);

  it("the composition module names no address, coordinate, geocode, photograph, broker, vendor or triage field outside the Snapshot's own declarations", () => {
    const decls = raw.split(/^(?=export |function |const |interface |type )/m);
    const offenders = decls
      .filter((d) => FORBIDDEN.test(d))
      .map((d) => /^(?:export\s+)?(?:async\s+)?(?:function|const|interface|type)\s+(\w+)/.exec(d)?.[1] ?? "(preamble)")
      .filter((n) => !SANCTIONED.has(n));
    expect(offenders).toEqual([]);
  });

  it("the seventeen prose sections cannot read the Snapshot's property facts at all", () => {
    const section = raw.slice(raw.indexOf("function keyMetrics"), raw.indexOf("export function composeSnapshot"));
    expect(section).not.toMatch(/src\.asset|\.asset\b|photoId|addressLine/);
  });

  it("and no server, database or model import", () => {
    expect(raw).not.toMatch(/from "@\/lib\/(db|data|supabase|auth)|from "pg"|anthropic|openai|fetch\(/);
  });

  it("an address and a photograph reach the Snapshot and NO prose section or other format's content", () => {
    const m = composeMemo(base({ asset: { reference: "RC-LON-0012", addressLine: "58 Queens Gate, London, SW7 5JW", photoId: "photo-123" } }));
    expect(m.snapshot).toMatchObject({ addressLine: "58 Queens Gate, London, SW7 5JW", photoId: "photo-123", ref: "RC-LON-0012" });
    const prose = JSON.stringify(m.sections);
    expect(prose).not.toContain("Queens Gate, London, SW7");
    expect(prose).not.toContain("photo-123");
    expect(prose).not.toContain("RC-LON-0012");
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
