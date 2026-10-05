// ============================================================================
// The Investment Score model and the rules a persisted score adds to it.
// ----------------------------------------------------------------------------
// model.ts had no tests; its arithmetic is what every stored score is read back
// through, so it is pinned here. score.ts is what turns it into something that can
// be saved: no overall until all eleven are scored, a deterministic summary, and
// validation of what a form posts.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  SCORE_CATEGORIES, CATEGORY_BY_KEY, TOTAL_WEIGHT, RECOMMENDATION_BANDS,
  computeOverall, recommendationFor, weightedContribution, type ScoreCategoryKey,
} from "@/lib/scoring/model";
import {
  viewScore, scoreSummary, validateScoreSubmission, isValidScore, RECOMMENDATION_LABEL, type CategoryScore,
} from "@/lib/scoring/score";

const all = (score: number | ((k: ScoreCategoryKey) => number), over: Partial<Record<ScoreCategoryKey, Partial<CategoryScore>>> = {}): CategoryScore[] =>
  SCORE_CATEGORIES.map((d) => ({
    key: d.key, score: typeof score === "function" ? score(d.key) : score, commentary: "", riskFlag: false, ...over[d.key],
  }));

describe("the model", () => {
  it("has eleven criteria whose weights sum to 100", () => {
    expect(SCORE_CATEGORIES).toHaveLength(11);
    expect(TOTAL_WEIGHT).toBe(100);
    expect(new Set(SCORE_CATEGORIES.map((c) => c.key)).size).toBe(11);
    expect(Object.keys(CATEGORY_BY_KEY)).toHaveLength(11);
  });

  it("contribution is weight x score / 10, and the overall is their sum", () => {
    expect(weightedContribution(8, 15)).toBe(12);
    expect(computeOverall(Object.fromEntries(SCORE_CATEGORIES.map((c) => [c.key, 10])))).toBe(100);
    expect(computeOverall(Object.fromEntries(SCORE_CATEGORIES.map((c) => [c.key, 5])))).toBe(50);
    expect(computeOverall(Object.fromEntries(SCORE_CATEGORIES.map((c) => [c.key, 1])))).toBe(10);
  });

  it("rounds to one decimal", () => {
    const s = Object.fromEntries(SCORE_CATEGORIES.map((c) => [c.key, 7.3]));
    expect(computeOverall(s)).toBe(73);
    expect(computeOverall({ location_quality: 7.7 })).toBe(11.6);
  });

  it("the bands change at exactly 85, 70, 55 and 40", () => {
    const at = (n: number) => recommendationFor(n);
    expect([at(100), at(85)]).toEqual(["strong_proceed", "strong_proceed"]);
    expect([at(84.9), at(70)]).toEqual(["proceed", "proceed"]);
    expect([at(69.9), at(55)]).toEqual(["proceed_with_caution", "proceed_with_caution"]);
    expect([at(54.9), at(40)]).toEqual(["weak", "weak"]);
    expect([at(39.9), at(0)]).toEqual(["reject", "reject"]);
    expect(RECOMMENDATION_BANDS.map((b) => b.min)).toEqual([85, 70, 55, 40, 0]);
  });
});

describe("an overall exists only when every criterion is scored", () => {
  it("a part-scored model has NO overall and NO recommendation, not a low one", () => {
    const v = viewScore([{ key: "location_quality", score: 9, commentary: "", riskFlag: false }]);
    expect(v).toMatchObject({ scored: 1, total: 11, complete: false, overall: null, recommendation: null, recommendationLabel: null });
    // computeOverall alone would have said Reject here: exactly the failure this prevents.
    expect(recommendationFor(computeOverall({ location_quality: 9 }))).toBe("reject");
    expect(scoreSummary(v)).toBeNull();
  });

  it("ten of eleven is still incomplete", () => {
    const rows = all(7); rows[10].score = null;
    expect(viewScore(rows).complete).toBe(false);
    expect(viewScore(rows).overall).toBeNull();
  });

  it("all eleven give the model's overall and band, and contributions per criterion", () => {
    const v = viewScore(all(8));
    expect(v.complete).toBe(true);
    expect(v.overall).toBe(80);
    expect(v.recommendation).toBe("proceed");
    expect(v.recommendationLabel).toBe("Proceed");
    expect(v.contributions.location_quality).toBe(12);
    expect(RECOMMENDATION_LABEL.strong_proceed).toBe("Strong Proceed");
  });

  it("an out-of-range or fractional-step score counts as unscored rather than skewing the overall", () => {
    const rows = all(8); rows[0].score = 11; rows[1].score = 0; rows[2].score = 7.3;
    const v = viewScore(rows);
    expect(v.scored).toBe(8);
    expect(v.complete).toBe(false);
  });
});

describe("the one-line summary is composed from the real score, or absent", () => {
  it("names the overall, the band, the weakest criterion and what is flagged: nothing else", () => {
    const rows = all((k) => (k === "capex_risk" ? 4 : 8), { capex_risk: { riskFlag: true, commentary: "wide QS range" } });
    expect(scoreSummary(viewScore(rows))).toBe("Overall 76.0 (Proceed). Weakest: Capex Risk (4/10, flagged). Flagged: Capex Risk.");
  });

  it("without flags it has no flag clause", () => {
    const rows = all((k) => (k === "strategic_fit" ? 6 : 8));
    expect(scoreSummary(viewScore(rows))).toBe("Overall 79.0 (Proceed). Weakest: Strategic Fit (6/10).");
  });

  it("breaks a tie on the heavier weight, then model order", () => {
    const rows = all(8, { tenant_covenant_risk: { score: 3 }, location_quality: { score: 3 } });
    expect(viewScore(rows).weakest?.key).toBe("location_quality");   // weight 15 beats 5
  });
});

describe("validation of what a form posts", () => {
  const ok = (rows: unknown) => validateScoreSubmission(rows);
  const row = (key: string, score: unknown, extra: Record<string, unknown> = {}) => ({ key, score, commentary: "", riskFlag: false, ...extra });

  it("accepts a part-finished score, and keeps unscored rows as null", () => {
    const r = ok([row("location_quality", 8), row("capex_risk", "")]);
    expect(r).toEqual({ ok: true, categories: [
      { key: "location_quality", score: 8, commentary: "", riskFlag: false },
      { key: "capex_risk", score: null, commentary: "", riskFlag: false }] });
  });

  it("accepts half points and refuses anything else", () => {
    expect(isValidScore(7.5)).toBe(true);
    for (const bad of [0, 0.5, 10.5, 11, 7.3, NaN, Infinity, -1]) expect(isValidScore(bad), String(bad)).toBe(false);
    expect(ok([row("location_quality", 7.3)])).toMatchObject({ ok: false, error: expect.stringContaining("half points") });
    expect(ok([row("location_quality", "abc")])).toMatchObject({ ok: false });
    expect(ok([row("location_quality", "1e1")])).toEqual({ ok: true, categories: [{ key: "location_quality", score: 10, commentary: "", riskFlag: false }] }); // Number("1e1") = 10, a valid score
  });

  it("refuses a criterion the model does not define, a duplicate, and a non-list", () => {
    expect(ok([row("vibes", 8)])).toMatchObject({ ok: false, error: "That is not a scoring criterion." });
    expect(ok([row("location_quality", 8), row("location_quality", 7)])).toMatchObject({ ok: false, error: expect.stringContaining("appears twice") });
    expect(ok("nope")).toMatchObject({ ok: false });
    expect(ok([null])).toMatchObject({ ok: false });
  });

  it("a flagged criterion must say why, and cannot be flagged unscored", () => {
    expect(ok([row("capex_risk", 4, { riskFlag: true })])).toMatchObject({ ok: false, error: "Capex Risk: say why it is flagged." });
    expect(ok([row("location_quality", 8), row("capex_risk", "", { riskFlag: true, commentary: "x" })])).toMatchObject({ ok: false, error: expect.stringContaining("give it a score") });
    expect(ok([row("capex_risk", 4, { riskFlag: true, commentary: "wide range" })])).toMatchObject({ ok: true });
  });

  it("needs at least one score, and bounds the commentary", () => {
    expect(ok([row("location_quality", "")])).toMatchObject({ ok: false, error: "Score at least one criterion." });
    expect(ok([row("location_quality", 8, { commentary: "x".repeat(4001) })])).toMatchObject({ ok: false, error: expect.stringContaining("longer than") });
  });

  it("never reads an overall or a recommendation from the browser", () => {
    const r = ok([{ ...row("location_quality", 8), overall: 99, recommendation: "strong_proceed" }]);
    expect(r).toEqual({ ok: true, categories: [{ key: "location_quality", score: 8, commentary: "", riskFlag: false }] });
  });
});
