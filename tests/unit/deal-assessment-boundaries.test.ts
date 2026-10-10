// ============================================================================
// What the deal assessment cannot do. Static checks over the source, in the
// style of memo-review-boundaries: no database and no model call.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssessmentSchema, boundTerms } from "@/lib/underwrite/assessment";
import { buildAssessmentPrompt, ASSESSMENT_SYSTEM_PROMPT } from "@/lib/underwrite/prompt";
import { buildReport } from "@/lib/underwrite/report";
import { INPUT_KEYS } from "@/lib/underwrite/inputs";
import { unsourcedFigures } from "@/lib/underwrite/figures";
import { MH_LEASES, MH_PARAMS } from "./deal-engine.fixture";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/--.*$/gm, "");

describe("the engine and the inputs are pure", () => {
  for (const f of ["engine.ts", "scenarios.ts", "inputs.ts", "defaults.ts", "report.ts", "prompt.ts", "assessment.ts", "figures.ts"]) {
    it(`${f} opens no connection, calls no model and reads no clock`, () => {
      const src = strip(read(`src/lib/underwrite/${f}`));
      expect(src).not.toMatch(/@\/lib\/db|@\/lib\/data|anthropic|fetch\(|server-only/i);
      expect(src).not.toMatch(/new Date\(\)|Date\.now\(/);
    });
  }
  it("the model call is server-only and takes no session", () => {
    const src = read("src/lib/underwrite/assess.ts");
    expect(src).toMatch(/^import "server-only";/m);
    expect(strip(src)).not.toMatch(/@\/lib\/db|@\/lib\/data/);
  });
});

describe("nothing here writes the underwriting", () => {
  it("the action imports no writer of investment cases, opportunities or properties", () => {
    const src = strip(read("src/app/actions/deal-assessment.ts"));
    expect(src).not.toMatch(/createVersion|updateVersion|makeCurrent|updateOpportunity|setStage/);
    expect(src).toMatch(/requireStaffSession/);
  });
  it("the data layer writes only deal_assessments", () => {
    const src = strip(read("src/lib/data/deal-assessments.ts")).toLowerCase();
    const writes = [...src.matchAll(/(insert into|update|delete from)\s+(\w+)/g)].map((m) => m[2]);
    expect(writes.every((t) => t === "deal_assessments")).toBe(true);
  });
  it("the bulk script never calls the model", () => {
    expect(strip(read("scripts/run-assessments.ts"))).not.toMatch(/runAssessment|underwrite\/assess"/);
  });
});

describe("the table is append-only and organisation-scoped", () => {
  const sql = strip(read("supabase/migrations/0036_deal_assessments.sql"));
  it("grants select and insert only", () => {
    expect(sql).toMatch(/grant select, insert on deal_assessments to authenticated/);
    expect(sql).not.toMatch(/for (update|delete|all) to authenticated/);
  });
  it("is for Reiwa staff within the organisation, never a client's own users", () => {
    expect(sql).toMatch(/using \(app\.is_staff\(\) and app\.has_org\(org_id\)\)/);
    expect(sql).toMatch(/with check \(app\.is_staff\(\) and app\.has_org\(org_id\) and app\.can_write\(\)\)/);
  });
  it("stamps the time and refuses another author; a deleted case keeps its runs", () => {
    expect(sql).toMatch(/new\.created_at := now\(\)/);
    expect(sql).toMatch(/new\.created_by is distinct from auth\.uid\(\)/);
    expect(sql).toMatch(/on delete set null \(case_id\)/);
  });
});

describe("what the assessment may say", () => {
  it("has no free-standing figure: the only numbers are the five priced levers", () => {
    const shape = AssessmentSchema.shape;
    const numeric: string[] = [];
    const walk = (s: unknown, path: string) => {
      const def = (s as { def?: { type?: string; shape?: Record<string, unknown>; element?: unknown; innerType?: unknown } }).def;
      if (!def) return;
      if (def.type === "number") numeric.push(path);
      if (def.type === "object" && def.shape) for (const [k, v] of Object.entries(def.shape)) walk(v, `${path}.${k}`);
      if (def.type === "array" && def.element) walk(def.element, `${path}[]`);
    };
    for (const [k, v] of Object.entries(shape)) walk(v, k);
    expect(numeric.sort()).toEqual([
      "proposedTerms.acqFeePct", "proposedTerms.deferredShare", "proposedTerms.extraGuaranteeMonths",
      "proposedTerms.priceFactor", "proposedTerms.topUpMonths",
    ]);
  });
  it("bounds the levers to what a buyer could table", () => {
    const t = boundTerms({ priceFactor: 0.3, deferredShare: 0.5, extraGuaranteeMonths: 99.6, topUpMonths: -3, acqFeePct: 0.2, rationale: [], otherTerms: [] });
    expect(t).toEqual({ priceFactor: 0.6, deferredShare: 0.15, extraGuaranteeMonths: 24, topUpMonths: 0, acqFeePct: 0.02 });
  });
  it("the system prompt forbids new numbers and names every evidence key", () => {
    expect(ASSESSMENT_SYSTEM_PROMPT).toMatch(/Do not calculate, estimate or state any number/);
    for (const k of INPUT_KEYS) expect(ASSESSMENT_SYSTEM_PROMPT).toContain(k);
  });
});

describe("what the assessment reads", () => {
  const report = buildReport("GBP", "lease", MH_LEASES, MH_PARAMS, [], []);
  const text = buildAssessmentPrompt({
    facts: {
      name: "Mutual House", market: "London", assetType: "retail", currency: "GBP", sizeSqft: 26854,
      opportunity: { targetPrice: 62675000, niy: 6.25, passingRent: null, erv: null, capexBudget: null },
      property: { tenure: "long_leasehold", unexpiredTermYears: 90.5, groundRentPa: 340000, groundRentNote: "12.5%", waultToExpiryYears: null, waultToBreaksYears: null, rentReviewMechanism: null, epcRating: null },
      case: null, fx: null,
    },
    sourceFacts: { agent: { name: "A", email: "a@example.com", phone: "0207" }, broker_contact: "x", tenant: "Hackett", _loader_flags: ["x"] },
    dataCompleteness: null, thesis: null, businessPlan: null,
  }, report);

  it("drops contact details and loader flags from the source facts", () => {
    expect(text).not.toContain("a@example.com");
    expect(text).not.toContain("0207");
    expect(text).not.toContain("broker_contact");
    expect(text).not.toContain("_loader_flags");
    expect(text).toContain("Hackett");
  });
  it("carries the engine's figures, every scenario and the price-for-target table", () => {
    expect(text).toMatch(/BASE CASE/);
    for (const s of report.scenarios) expect(text).toContain(s.label);
    expect(text).toMatch(/PRICE FOR TARGET/);
  });
});

describe("nothing investor- or prospect-facing reads an assessment", () => {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
  });
  const facing = [
    ...walk("src/app/(portal)"), ...walk("src/app/(prospect)"), ...walk("src/components/portal"),
    ...walk("src/components/deal-share"), ...walk("src/lib/portal"), ...walk("src/lib/publication"), ...walk("src/lib/deal-share"),
  ].filter((f) => /\.(ts|tsx)$/.test(f));
  it("no portal, prospect or publication file imports the assessment", () => {
    for (const f of facing) expect(read(f), f).not.toMatch(/deal-assessment|lib\/underwrite\//);
  });
});

describe("figures in the written view are checked against what was shown", () => {
  const base = {
    verdict: "pass" as const, headline: "", rationale: "", strengths: [], concerns: [], mostExposedTo: "exit_yield" as const,
    exposureReason: "x", evidence: [], icQuestions: [], dataGaps: [],
    proposedTerms: { priceFactor: 1, deferredShare: 0, extraGuaranteeMonths: 0, topUpMonths: 0, acqFeePct: 0.01, rationale: [], otherTerms: [] },
  };
  const shown = "investor IRR 8.04% | hedged yen 5.44% | value 75.84M | multiple 1.44x";
  it("accepts figures that round to one it was shown", () => {
    expect(unsourcedFigures({ ...base, headline: "Yen 5.4%, sterling 8%, value £75.8M, 1.44x" }, shown)).toEqual([]);
  });
  it("flags figures it was never shown", () => {
    expect(unsourcedFigures({ ...base, rationale: "At £58M the yen return would be 7.1%." }, shown)).toEqual(["7.1%", "£58M"]);
  });
});
