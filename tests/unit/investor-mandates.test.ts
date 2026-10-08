import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseMandateInput, toMandateInput, hasCriteria, EMPTY_MANDATE, MAX_LIST, type Mandate,
} from "@/lib/mandate/mandate";
import {
  matchMandate, rankDealsForInvestor, rankInvestorsForDeal, type MandateDeal,
} from "@/lib/mandate/match";
import { MatchingDealsCard, MatchingInvestorsCard } from "@/components/admin/mandate-matches";

const M = (over: Partial<Mandate>): Mandate => ({ ...EMPTY_MANDATE, ...over });
const DEAL: MandateDeal = {
  market: "London", assetType: "office", strategy: "value_add", currency: "GBP", totalCost: 20_000_000, entryYieldPct: 6.5,
};
const D = (over: Partial<MandateDeal>): MandateDeal => ({ ...DEAL, ...over });
const outcome = (m: Mandate, d: MandateDeal, c: string) => matchMandate(m, d).checks.find((x) => x.criterion === c)?.outcome;

describe("a mandate that states nothing", () => {
  it("matches no deal, rather than every deal", () => {
    expect(hasCriteria(EMPTY_MANDATE)).toBe(false);
    expect(matchMandate(EMPTY_MANDATE, DEAL)).toEqual({ verdict: "no_mandate", checks: [], passed: 0 });
    expect(rankInvestorsForDeal(DEAL, [{ name: "A", mandate: EMPTY_MANDATE }])).toEqual([]);
  });
});

describe("list preferences are any-of, and a blank group is not tested", () => {
  it("passes when the deal's value is one of the wanted", () => {
    expect(outcome(M({ assetTypes: ["office", "mixed_use"] }), DEAL, "assetType")).toBe("pass");
    expect(outcome(M({ assetTypes: ["office", "mixed_use"] }), D({ assetType: "mixed_use" }), "assetType")).toBe("pass");
  });
  it("fails when it is none of them", () => {
    expect(outcome(M({ assetTypes: ["retail", "mixed_use"] }), DEAL, "assetType")).toBe("fail");
    expect(outcome(M({ strategies: ["core"] }), DEAL, "strategy")).toBe("fail");
  });
  it("compares a market without regard to case or spacing", () => {
    expect(outcome(M({ markets: ["london"] }), D({ market: "  London " }), "market")).toBe("pass");
    expect(outcome(M({ markets: ["Amsterdam"] }), DEAL, "market")).toBe("fail");
  });
  it("is unknown, not a failure, when the deal has no value", () => {
    expect(outcome(M({ markets: ["London"] }), D({ market: null }), "market")).toBe("unknown");
    expect(outcome(M({ markets: ["London"] }), D({ market: "  " }), "market")).toBe("unknown");
  });
  it("does not test a group nothing is ticked in", () => {
    const r = matchMandate(M({ markets: ["London"] }), DEAL);
    expect(r.checks.map((c) => c.criterion)).toEqual(["market"]);
  });
});

describe("deal size is compared with total cost, inclusive at both ends", () => {
  const m = M({ dealSizeMin: 10_000_000, dealSizeMax: 20_000_000 });
  it("passes inside the range and exactly on either end", () => {
    expect(outcome(m, D({ totalCost: 15_000_000 }), "dealSize")).toBe("pass");
    expect(outcome(m, D({ totalCost: 10_000_000 }), "dealSize")).toBe("pass");
    expect(outcome(m, D({ totalCost: 20_000_000 }), "dealSize")).toBe("pass");
  });
  it("fails just outside", () => {
    expect(outcome(m, D({ totalCost: 9_999_999 }), "dealSize")).toBe("fail");
    expect(outcome(m, D({ totalCost: 20_000_001 }), "dealSize")).toBe("fail");
  });
  it("works with only one end", () => {
    expect(outcome(M({ dealSizeMin: 30_000_000 }), DEAL, "dealSize")).toBe("fail");
    expect(outcome(M({ dealSizeMax: 30_000_000 }), DEAL, "dealSize")).toBe("pass");
  });
  it("is unknown with no total cost, and unknown in another currency (no rate is applied)", () => {
    expect(outcome(m, D({ totalCost: null }), "dealSize")).toBe("unknown");
    const jpy = matchMandate(m, D({ currency: "JPY", totalCost: 3_000_000_000 }));
    expect(jpy.checks[0]).toMatchObject({ outcome: "unknown" });
    expect(jpy.checks[0].reason).toContain("JPY");
  });
});

describe("entry yield is a minimum", () => {
  const m = M({ minEntryYieldPct: 6.5 });
  it("passes at exactly the minimum, fails below, unknown with none", () => {
    expect(outcome(m, D({ entryYieldPct: 6.5 }), "entryYield")).toBe("pass");
    expect(outcome(m, D({ entryYieldPct: 6.49 }), "entryYield")).toBe("fail");
    expect(outcome(m, D({ entryYieldPct: null }), "entryYield")).toBe("unknown");
  });
});

describe("the verdict", () => {
  const m = M({ markets: ["London"], assetTypes: ["office"], minEntryYieldPct: 6 });
  it("is fit when every stated preference passes", () => {
    const r = matchMandate(m, DEAL);
    expect(r).toMatchObject({ verdict: "fit", passed: 3 });
    expect(r.checks.map((c) => c.criterion)).toEqual(["market", "assetType", "entryYield"]);
  });
  it("is possible when nothing fails but something is unknown", () => {
    expect(matchMandate(m, D({ entryYieldPct: null }))).toMatchObject({ verdict: "possible", passed: 2 });
  });
  it("is no_fit when anything fails, even if something else is unknown", () => {
    expect(matchMandate(m, D({ assetType: "retail", entryYieldPct: null })).verdict).toBe("no_fit");
  });
  it("explains each check in a line", () => {
    const r = matchMandate(M({ assetTypes: ["office", "mixed_use"] }), DEAL);
    expect(r.checks[0].reason).toBe("Asset type: Office is one of Office, Mixed Use");
  });
});

describe("ranking", () => {
  const mandate = M({ markets: ["London"], assetTypes: ["office"] });
  const deals = [
    { name: "C", ...D({}) },
    { name: "A", ...D({ assetType: null }) },     // possible
    { name: "B", ...D({}) },
    { name: "Z", ...D({ market: "Paris" }) },      // no fit: excluded
  ];
  it("puts fit before possible, then by name, and leaves out what does not fit", () => {
    expect(rankDealsForInvestor(mandate, deals).map((r) => r.item.name)).toEqual(["B", "C", "A"]);
  });
  it("gives the same order for the same input however it arrives", () => {
    const a = rankDealsForInvestor(mandate, deals).map((r) => r.item.name);
    const b = rankDealsForInvestor(mandate, [...deals].reverse()).map((r) => r.item.name);
    expect(b).toEqual(a);
  });
  it("ranks investors for a deal the same way", () => {
    const investors = [
      { name: "Beta", mandate: M({ markets: ["London"] }) },
      { name: "Alpha", mandate: M({ markets: ["London"], minEntryYieldPct: 9 }) }, // fails
      { name: "Gamma", mandate: M({ markets: ["London"], assetTypes: ["office"] }) },
    ];
    expect(rankInvestorsForDeal(DEAL, investors).map((r) => r.item.name)).toEqual(["Gamma", "Beta"]);
  });
});

describe("the editor's input", () => {
  const base = { markets: [], assetTypes: [], strategies: [], dealSizeMinM: "", dealSizeMaxM: "", currency: "GBP", minEntryYieldPct: "" };
  it("converts millions to whole units, and back", () => {
    const r = parseMandateInput({ ...base, markets: ["London"], dealSizeMinM: "10", dealSizeMaxM: "42.5", minEntryYieldPct: "6.25" });
    expect(r).toMatchObject({ ok: true, mandate: { dealSizeMin: 10_000_000, dealSizeMax: 42_500_000, minEntryYieldPct: 6.25 } });
    if (r.ok) expect(toMandateInput(r.mandate)).toMatchObject({ dealSizeMinM: "10", dealSizeMaxM: "42.5", minEntryYieldPct: "6.25" });
  });
  it("trims, de-duplicates and sorts lists", () => {
    const r = parseMandateInput({ ...base, markets: [" London", "london", "Amsterdam  ", ""] });
    expect(r.ok && r.mandate.markets).toEqual(["Amsterdam", "London"]);
  });
  it("accepts only the asset types and strategies deals use", () => {
    expect(parseMandateInput({ ...base, assetTypes: ["Spaceport"] })).toMatchObject({ ok: false });
    expect(parseMandateInput({ ...base, strategies: ["yolo"] })).toMatchObject({ ok: false });
    expect(parseMandateInput({ ...base, assetTypes: ["office"], strategies: ["core_plus"] }).ok).toBe(true);
  });
  it("caps a list at 12", () => {
    const twelve = Array.from({ length: MAX_LIST }, (_, i) => `Market ${i}`);
    expect(parseMandateInput({ ...base, markets: twelve }).ok).toBe(true);
    expect(parseMandateInput({ ...base, markets: [...twelve, "One more"] })).toMatchObject({ ok: false });
  });
  it("refuses a minimum above the maximum, and malformed numbers, in plain words", () => {
    expect(parseMandateInput({ ...base, dealSizeMinM: "50", dealSizeMaxM: "10" })).toEqual({ ok: false, error: "The minimum deal size is above the maximum." });
    expect(parseMandateInput({ ...base, dealSizeMinM: "ten" })).toMatchObject({ ok: false });
    expect(parseMandateInput({ ...base, dealSizeMinM: "-5" })).toMatchObject({ ok: false });
    expect(parseMandateInput({ ...base, minEntryYieldPct: "101" })).toMatchObject({ ok: false });
    expect(parseMandateInput({ ...base, minEntryYieldPct: "6%" })).toMatchObject({ ok: false });
    expect(parseMandateInput({ ...base, currency: "XXX" })).toMatchObject({ ok: false });
  });
  it("copes with junk instead of throwing", () => {
    expect(parseMandateInput(null)).toMatchObject({ ok: true });
    expect(parseMandateInput({ markets: "London" as unknown as string[] })).toMatchObject({ ok: false });
    expect(parseMandateInput({ markets: [42 as unknown as string] })).toMatchObject({ ok: false });
  });
});

describe("the cards", () => {
  const checks = [{ criterion: "market" as const, outcome: "pass" as const, reason: "Market: London is one of London" }];
  it("list matching deals with a verdict and the reasons", () => {
    const html = renderToStaticMarkup(createElement(MatchingDealsCard, {
      hasMandate: true,
      deals: [{ opportunityId: "11111111-1111-1111-1111-111111111111", name: "ZZTEST Hall", market: "London", assetType: "office", stage: "new", verdict: "fit", passed: 1, checks }],
    }));
    expect(html).toContain("ZZTEST Hall"); expect(html).toContain("Fits"); expect(html).toContain("Market: London is one of London");
    expect(html).toContain("Not the investment score");
  });
  it("say what is missing rather than render an empty list", () => {
    expect(renderToStaticMarkup(createElement(MatchingDealsCard, { hasMandate: false, deals: [] }))).toContain("Record a mandate");
    expect(renderToStaticMarkup(createElement(MatchingInvestorsCard, { mandateCount: 0, investors: [] }))).toContain("No investor organisation has recorded a mandate");
    expect(renderToStaticMarkup(createElement(MatchingInvestorsCard, { mandateCount: 3, investors: [] }))).toContain("No active investor");
  });
});

// ---- Boundaries --------------------------------------------------------------
const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(rel(p));
  }
  return out;
}
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("the mandate stays apart from the investment score and from the investor side", () => {
  it("nothing in the mandate module imports the scoring module", () => {
    for (const f of walk(join(ROOT, "src/lib/mandate"))) {
      expect(read(f), f).not.toMatch(/from\s+["'][^"']*scor(e|ing)[^"']*["']/);
    }
  });

  it("only the staff-side files mention investor_mandates or the mandate modules", () => {
    const allowed = new Set([
      "src/lib/data/investor-mandates.ts", "src/app/actions/investor-mandates.ts",
      "src/components/admin/investor-mandate.tsx", "src/components/admin/mandate-matches.tsx",
      "src/app/(app)/admin/investors/[investorOrgId]/page.tsx",
      "src/app/(app)/opportunities/[opportunityId]/publication/page.tsx",
    ]);
    const hits = walk(join(ROOT, "src"))
      .filter((f) => !f.startsWith("src/lib/mandate/"))
      .filter((f) => /investor_mandates|lib\/mandate\/|investor-mandates|mandate-matches|investor-mandate"/.test(read(f)))
      .filter((f) => !allowed.has(f));
    expect(hits).toEqual([]);
  });

  it("no investor-facing code path reaches the mandate", () => {
    for (const f of walk(join(ROOT, "src")).filter((p) => p.startsWith("src/app/(portal)") || p === "src/lib/data/portal-feed.ts")) {
      expect(read(f), f).not.toMatch(/mandate/i);
    }
  });
});
